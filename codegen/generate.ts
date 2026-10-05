/**
 * Generate the types, resources and client from the OpenAPI spec.
 *
 * Usage:
 *   pnpm codegen                    # the pinned spec, through the GitHub CLI
 *   pnpm codegen --spec-dir DIR     # a checkout of it
 *   pnpm codegen --pin v0.5.0       # pin another tag
 *
 * The spec lives in the private mawaqit/api-spec repository, pinned by tag and SHA-256 in
 * codegen/spec.json; only `--pin` changes the pin. Its examples, real API responses, are copied to
 * tests/examples.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { parse as parseYAML } from 'yaml';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
const RESOURCES = join(SRC, 'resources');
const EXAMPLES = join(ROOT, 'tests', 'examples');
const PIN = join(import.meta.dirname, 'spec.json');
const WIDTH = 100;

// The error thrown for each documented error status.
const ERRORS: Record<string, string> = {
  '400': 'BadRequestError',
  '401': 'AuthenticationError',
  '403': 'PermissionDeniedError',
  '404': 'NotFoundError',
  '429': 'RateLimitError',
};
const BASIC_AUTH_PARAMS: [string, string][] = [
  ['email', 'Email of the MAWAQIT account.'],
  ['password', 'Password of the MAWAQIT account.'],
];
// Query parameters that exclude each other, which OpenAPI cannot describe: each variant becomes a
// type of its own, so that TypeScript rejects a call that mixes them.
const VARIANTS: Record<string, Variant[]> = {
  mosquesSearch: [
    { name: 'ByWords', title: 'by words', required: ['word'], optional: [] },
    {
      name: 'AroundPosition',
      title: 'around a position',
      required: ['lat', 'lon'],
      optional: ['radius'],
    },
  ],
};

interface Variant {
  name: string;
  title: string;
  required: string[];
  optional: string[];
}

interface Pin {
  repository: string;
  ref: string;
  path: string;
  sha256: string;
}

// The subset of OpenAPI 3.1 the spec uses.
interface Schema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  description?: string;
  deprecated?: boolean;
  anyOf?: Schema[];
  items?: Schema;
  properties?: Record<string, Schema>;
  additionalProperties?: Schema;
  required?: string[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
}

interface Parameter {
  $ref?: string;
  name: string;
  in: 'path' | 'query';
  required?: boolean;
  description: string;
  schema: Schema;
}

interface Response {
  $ref?: string;
  description: string;
  content?: Record<string, { schema: Schema }>;
}

interface OperationSpec {
  tags: [string];
  operationId: string;
  summary: string;
  description: string;
  security?: Record<string, string[]>[];
  parameters?: Parameter[];
  responses: Record<string, Response>;
}

interface Spec {
  security?: Record<string, string[]>[];
  tags: { name: string; description: string }[];
  paths: Record<string, Record<string, OperationSpec>>;
  components: {
    schemas: Record<string, Schema>;
    parameters?: Record<string, Parameter>;
    responses?: Record<string, Response>;
  };
}

class SpecError extends Error {}

// Text

const camel = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);
const pascal = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

function firstSentence(text: string): string {
  return text.split(/(?<=\.) /, 1)[0] as string;
}

/** Wrap paragraphs into the lines of a doc comment, without the comment markers. */
function wrap(paragraph: string, width: number, indent = ''): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = indent + word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  return line ? [...lines, line] : lines;
}

/** Return a doc comment, indented by `indent` spaces. */
function docComment(blocks: string[][], indent: number): string {
  const pad = ' '.repeat(indent);
  const lines = blocks.flatMap((block, i) => (i ? ['', ...block] : block));
  const [first] = lines;
  if (lines.length === 1 && first !== undefined && pad.length + first.length + 7 <= WIDTH) {
    return `${pad}/** ${first} */\n`;
  }
  const body = lines.map((line) => (line ? `${pad} * ${line}` : `${pad} *`)).join('\n');
  return `${pad}/**\n${body}\n${pad} */\n`;
}

class CodeGenerator {
  readonly spec: Spec;
  // Every operation a description can quote, with its name in this library.
  readonly #names = new Map<string, string>();

  constructor(spec: Spec) {
    this.spec = spec;
    for (const operation of this.#operations()) {
      const [tag] = operation.spec.tags;
      const method = camel(operation.spec.operationId.slice(tag.length));
      this.#names.set(operation.spec.operationId, `client.${tag}.${method}()`);
    }
  }

  /** Translate the operations quoted in a description to their names in this library. */
  text(text: string): string {
    return text
      .split(/\s+/)
      .join(' ')
      .trim()
      .replace(/`([^`]+)`/g, (match, word: string) =>
        this.#names.has(word) ? `\`${this.#names.get(word)}\`` : match,
      );
  }

  paragraphs(text: string | undefined): string[] {
    return (text ?? '')
      .trim()
      .split(/\n\s*\n/)
      .filter(Boolean)
      .map((p) => this.text(p));
  }

  /** The doc comment blocks of a description, wrapped to fit at `indent`. */
  blocks(text: string | undefined, indent: number): string[][] {
    return this.paragraphs(text).map((p) => wrap(p, WIDTH - indent - 3));
  }

  // Types

  resolve<T extends { $ref?: string }>(node: T): T {
    if (!node.$ref) {
      return node;
    }
    let target: unknown = this.spec;
    for (const part of node.$ref.replace(/^#\//, '').split('/')) {
      target = (target as Record<string, unknown>)[part];
    }
    return target as T;
  }

  type(schema: Schema, refs: Set<string>): string {
    if (schema.$ref) {
      const name = schema.$ref.replace('#/components/schemas/', '');
      refs.add(name);
      return name;
    }
    if (schema.anyOf) {
      const [other, nullable, ...rest] = schema.anyOf;
      if (!other?.$ref || nullable?.type !== 'null' || rest.length) {
        throw new SpecError(`unsupported anyOf ${JSON.stringify(schema.anyOf)}`);
      }
      return `${this.type(other, refs)} | null`;
    }
    const types = typeof schema.type === 'string' ? [schema.type] : (schema.type ?? []);
    const kinds = types.filter((t) => t !== 'null');
    const [kind] = kinds;
    if (kinds.length !== 1 || !kind) {
      throw new SpecError(`unsupported type ${JSON.stringify(schema.type)}`);
    }
    let type: string;
    if (kind === 'array') {
      const item = this.type(schema.items ?? {}, refs);
      type = item.includes(' ') ? `(${item})[]` : `${item}[]`;
    } else if (kind === 'object') {
      if (schema.properties || !schema.additionalProperties) {
        throw new SpecError('objects with properties must be components');
      }
      type = `Record<string, ${this.type(schema.additionalProperties, refs)}>`;
    } else {
      const scalars: Record<string, string> = {
        string: 'string',
        integer: 'number',
        number: 'number',
        boolean: 'boolean',
      };
      type = scalars[kind] ?? '';
      if (!type) {
        throw new SpecError(`unsupported type ${kind}`);
      }
    }
    return types.includes('null') ? `${type} | null` : type;
  }

  /** The interfaces of the schemas the operations return, in the order of the spec. */
  models(): string {
    const used = new Set<string>();
    const visit = (name: string): void => {
      if (used.has(name)) {
        return;
      }
      used.add(name);
      const refs = new Set<string>();
      for (const prop of Object.values(this.spec.components.schemas[name]?.properties ?? {})) {
        this.type(prop, refs);
      }
      refs.forEach(visit);
    };
    for (const operation of this.#operations()) {
      const refs = new Set<string>();
      this.type(this.#successSchema(operation.spec), refs);
      refs.forEach(visit);
    }
    return Object.entries(this.spec.components.schemas)
      .filter(([name]) => used.has(name))
      .map(([name, schema]) => this.#model(name, schema))
      .join('\n');
  }

  #model(name: string, schema: Schema): string {
    if (schema.type !== 'object' || !schema.properties) {
      throw new SpecError(`${name}: only object schemas can be components`);
    }
    const required = new Set(schema.required);
    const fields = Object.entries(schema.properties).map(([prop, propSchema]) => {
      const blocks = this.blocks(propSchema.description ?? this.resolve(propSchema).description, 2);
      if (propSchema.deprecated) {
        const advice = firstSentence(
          this.paragraphs(propSchema.description)
            .join(' ')
            .split(/(?<=\.) /)
            .find((s) => s.startsWith('Use ')) ?? 'Deprecated.',
        );
        blocks.push([`@deprecated ${advice}`]);
      }
      const optional = required.has(prop) ? '' : '?';
      return `${docComment(blocks, 2)}  ${prop}${optional}: ${this.type(propSchema, new Set())};\n`;
    });
    return `${docComment(this.blocks(schema.description, 0), 0)}export interface ${name} {\n${fields.join('\n')}}\n`;
  }

  // Operations

  *#operations(): Generator<{ path: string; method: string; spec: OperationSpec }> {
    for (const [path, item] of Object.entries(this.spec.paths)) {
      for (const [method, spec] of Object.entries(item)) {
        yield { path, method, spec };
      }
    }
  }

  #successSchema(operation: OperationSpec): Schema {
    const schema = operation.responses['200']?.content?.['application/json']?.schema;
    if (!schema) {
      throw new SpecError(`${operation.operationId} has no JSON response`);
    }
    return schema;
  }

  #paramDoc(param: Parameter): string {
    const { schema } = param;
    const notes: string[] = [];
    if (schema.minimum !== undefined && schema.maximum !== undefined) {
      notes.push(`From ${schema.minimum} to ${schema.maximum}`);
    } else if (schema.minimum !== undefined) {
      notes.push(`At least ${schema.minimum}`);
    }
    if (schema.default !== undefined) {
      notes.push(`${schema.default} by default`);
    }
    const doc = this.text(param.description);
    return notes.length ? `${doc} ${notes.join(', ')}.` : doc;
  }

  /** The resources, one per tag, as modules. */
  resources(): Map<string, string> {
    const modules = new Map<string, string>();
    for (const tag of this.spec.tags) {
      const methods: string[] = [];
      const declarations: string[] = [];
      const models = new Set<string>();
      for (const { path, method, spec } of this.#operations()) {
        if (spec.tags[0] !== tag.name) {
          continue;
        }
        if (!spec.operationId.startsWith(tag.name)) {
          throw new SpecError(`${spec.operationId} does not start with its tag ${tag.name}`);
        }
        const { method: code, declaration } = this.#operation(path, method, spec, models);
        methods.push(code);
        declarations.push(...declaration);
      }
      const className = pascal(tag.name);
      const imports = [...models].sort().join(', ');
      modules.set(
        tag.name,
        [
          `import type { APIClient, RequestOptions } from '../core.ts';`,
          ...(imports ? [`import type { ${imports} } from '../types.ts';`] : []),
          '',
          ...declarations,
          docComment(this.blocks(tag.description, 0), 0) +
            `export class ${className} {\n  readonly #client: APIClient;\n\n` +
            `  constructor(client: APIClient) {\n    this.#client = client;\n  }\n\n` +
            `${methods.join('\n')}}\n`,
        ].join('\n'),
      );
    }
    return modules;
  }

  #operation(
    path: string,
    httpMethod: string,
    spec: OperationSpec,
    models: Set<string>,
  ): { method: string; declaration: string[] } {
    const [tag] = spec.tags;
    const name = camel(spec.operationId.slice(tag.length));
    const params = (spec.parameters ?? []).map((p) => this.resolve(p));
    const pathParams = params.filter((p) => p.in === 'path');
    const queryParams = params.filter((p) => p.in === 'query');
    const schemes = new Set(
      (spec.security ?? this.spec.security ?? []).flatMap((requirement) =>
        Object.keys(requirement),
      ),
    );
    const basicAuth = schemes.has('basicAuth');
    const returns = this.type(this.#successSchema(spec), models);
    const paramsType = `${pascal(spec.operationId)}Params`;
    const declaration: string[] = [];

    // The signature: path parameters first, then the others in one object.
    const args = pathParams.map((p) => `${p.name}: ${this.type(p.schema, new Set())}`);
    const docParams = pathParams.map((p) =>
      wrap(`@param ${p.name} - ${this.#paramDoc(p)}`, WIDTH - 7, '  '),
    );
    if (queryParams.length || basicAuth) {
      const required =
        basicAuth || queryParams.some((p) => p.required) || spec.operationId in VARIANTS;
      args.push(`params: ${paramsType}${required ? '' : ' = {}'}`);
      docParams.push(
        wrap(`@param params - The parameters, see {@link ${paramsType}}.`, WIDTH - 7, '  '),
      );
      declaration.push(this.#paramsType(spec, paramsType, queryParams, basicAuth));
    }
    args.push('options?: RequestOptions');
    docParams.push(['@param options - Options of this request, like its `timeout` or `signal`.']);

    const throws = Object.entries(spec.responses)
      .filter(([status]) => status !== '200')
      .map(([status, response]) => {
        const error = ERRORS[status];
        if (!error) {
          throw new SpecError(`${spec.operationId}: no error for HTTP ${status}`);
        }
        const doc = firstSentence(this.text(this.resolve(response).description));
        return wrap(`@throws {${error}} ${doc}`, WIDTH - 7, '  ');
      });
    throws.push(['@throws {APIError} The request failed in another way.']);

    const description = this.blocks(spec.description, 2);
    const doc = docComment(
      [
        [`${spec.summary}.`],
        ...description,
        [
          ...docParams.flat(),
          `@returns ${this.text(spec.responses['200']?.description ?? '')}`,
          ...throws.flat(),
        ],
      ],
      2,
    );

    const operation = [
      `method: '${httpMethod.toUpperCase()}'`,
      `path: '${path}'`,
      pathParams.length && `pathParams: { ${pathParams.map((p) => p.name).join(', ')} }`,
      queryParams.length &&
        `query: { ${queryParams.map((p) => `${p.name}: params.${p.name}`).join(', ')} }`,
      basicAuth && 'basicAuth: [params.email, params.password]',
      `authenticated: ${schemes.has('apiToken')}`,
    ].filter(Boolean);
    const method =
      `${doc}  ${name}(${args.join(', ')}): Promise<${returns}> {\n` +
      `    return this.#client.request({ ${operation.join(', ')} }, options);\n  }\n`;
    return { method, declaration };
  }

  #paramsType(spec: OperationSpec, name: string, params: Parameter[], basicAuth: boolean): string {
    const field = (param: Parameter, mode: 'required' | 'optional' | 'never'): string => {
      if (mode === 'never') {
        return `  ${param.name}?: never;\n`;
      }
      const doc = docComment(
        this.paragraphs(this.#paramDoc(param)).map((p) => wrap(p, WIDTH - 5)),
        2,
      );
      const type = this.type(param.schema, new Set());
      return `${doc}  ${param.name}${mode === 'required' ? '' : '?'}: ${type};\n`;
    };
    const summary = `The parameters of \`${this.#names.get(spec.operationId)}\`.`;
    const variants = VARIANTS[spec.operationId];
    if (!variants) {
      const fields = params.map((p) => field(p, p.required ? 'required' : 'optional'));
      if (basicAuth) {
        fields.push(
          ...BASIC_AUTH_PARAMS.map(([key, doc]) => `  /** ${doc} */\n  ${key}: string;\n`),
        );
      }
      return `${docComment([[summary]], 0)}export interface ${name} {\n${fields.join('\n')}}\n`;
    }
    const inVariants = new Set(variants.flatMap((v) => [...v.required, ...v.optional]));
    for (const key of inVariants) {
      if (!params.some((p) => p.name === key)) {
        throw new SpecError(`${spec.operationId} has no parameter ${key}`);
      }
    }
    const names = variants.map((v) => `${pascal(spec.operationId)}${v.name}Params`);
    const declarations = variants.map((variant, i) => {
      const fields = params.map((p) => {
        if (variant.required.includes(p.name)) {
          return field(p, 'required');
        }
        if (variant.optional.includes(p.name) || !inVariants.has(p.name)) {
          return field(p, 'optional');
        }
        return field(p, 'never');
      });
      return `${docComment([[`${summary.slice(0, -1)}, ${variant.title}.`]], 0)}export interface ${names[i]} {\n${fields.join('')}}\n`;
    });
    return [
      `${docComment([[summary]], 0)}export type ${name} = ${names.join(' | ')};\n`,
      ...declarations,
    ].join('\n');
  }

  client(): string {
    const fields = this.spec.tags.map(
      (tag) =>
        `${docComment([[this.text(tag.description)]], 2)}  readonly ${tag.name}: ${pascal(tag.name)} = new ${pascal(tag.name)}(this);\n`,
    );
    const imports = this.spec.tags.map(
      (tag) => `import { ${pascal(tag.name)} } from './resources/${tag.name}.ts';`,
    );
    return [
      `import { APIClient } from './core.ts';`,
      ...imports,
      '',
      `/**
 * The client of the MAWAQIT API.
 *
 * \`\`\`ts
 * const client = new Mawaqit(); // Reads MAWAQIT_TOKEN.
 * const [mosque] = await client.mosques.search({ lat: 48.8414, lon: 2.3557 });
 * if (mosque) {
 *   const prayerTimes = await client.mosques.prayerTimes(mosque.uuid);
 * }
 * \`\`\`
 */
export class Mawaqit extends APIClient {
${fields.join('\n')}}
`,
    ].join('\n');
  }
}

// Files

function readTree(root: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const folder of ['openapi', 'examples']) {
    for (const entry of readdirSync(join(root, folder), { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) {
        const path = join(entry.parentPath, entry.name);
        files.set(relative(root, path).split('\\').join('/'), readFileSync(path));
      }
    }
  }
  return files;
}

function download(pin: Pin): Map<string, Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'mawaqit-spec-'));
  try {
    const archive = execFileSync('gh', ['api', `repos/${pin.repository}/tarball/${pin.ref}`], {
      maxBuffer: 64 * 1024 * 1024,
    });
    writeFileSync(join(dir, 'spec.tar.gz'), archive);
    execFileSync('tar', ['-xzf', 'spec.tar.gz', '--strip-components=1'], { cwd: dir });
    return readTree(dir);
  } catch (error) {
    throw new Error('Could not download the spec: install the GitHub CLI, or pass --spec-dir.', {
      cause: error,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Write files, and delete the other files of the folder to prune. */
function write(files: Map<string, string | Buffer>, prune?: string): void {
  if (prune) {
    for (const entry of readdirSync(prune, { recursive: true, withFileTypes: true })) {
      const path = join(entry.parentPath, entry.name);
      if (entry.isFile() && !files.has(path)) {
        rmSync(path);
      }
    }
  }
  for (const [path, content] of files) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

function main(): void {
  const { values } = parseArgs({
    options: { 'spec-dir': { type: 'string' }, pin: { type: 'string' } },
  });
  if (values['spec-dir'] && values.pin) {
    throw new Error('Pass --spec-dir or --pin, not both.');
  }
  const pin = JSON.parse(readFileSync(PIN, 'utf8')) as Pin;
  if (values.pin) {
    pin.ref = values.pin;
  }
  const specFiles = values['spec-dir'] ? readTree(values['spec-dir']) : download(pin);
  const content = specFiles.get(pin.path);
  if (!content) {
    throw new Error(`The spec has no ${pin.path}.`);
  }
  const digest = createHash('sha256').update(content).digest('hex');
  if (values.pin) {
    pin.sha256 = digest;
    writeFileSync(PIN, `${JSON.stringify(pin, null, 2)}\n`);
  } else if (digest !== pin.sha256) {
    throw new Error(
      `The spec differs from ${pin.repository} ${pin.ref}: pin it with --pin instead.`,
    );
  }

  const generator = new CodeGenerator(parseYAML(content.toString('utf8')) as Spec);
  const header = `// Generated by codegen/generate.ts from ${pin.repository} ${pin.ref}. Do not edit.\n\n`;
  const code = new Map<string, string>([
    [join(SRC, 'types.ts'), `${header}${generator.models()}`],
    [join(SRC, 'client.ts'), `${header}${generator.client()}`],
  ]);
  const resources = new Map<string, string>();
  for (const [name, module] of generator.resources()) {
    resources.set(join(RESOURCES, `${name}.ts`), `${header}${module}`);
  }
  const reexports = generator.spec.tags.map((tag) => `export * from './${tag.name}.ts';\n`);
  resources.set(join(RESOURCES, 'index.ts'), `${header}${reexports.join('')}`);
  write(code);
  // Unlike the rest of the package, the resources are all generated.
  mkdirSync(RESOURCES, { recursive: true });
  write(resources, RESOURCES);
  const paths = [...code.keys(), ...resources.keys()];
  execFileSync('pnpm', ['exec', 'biome', 'check', '--write', '--log-level=error', ...paths], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  const examples = new Map<string, Buffer>();
  for (const [path, data] of specFiles) {
    if (path.startsWith('examples/') && path.endsWith('.json')) {
      examples.set(join(EXAMPLES, path.slice('examples/'.length)), data);
    }
  }
  mkdirSync(EXAMPLES, { recursive: true });
  write(examples, EXAMPLES);
  console.log(
    `Generated ${paths.length} files and ${examples.size} examples from ${pin.repository} ${pin.ref}.`,
  );
}

main();
