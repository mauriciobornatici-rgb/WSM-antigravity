import { spawnSync } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const AUDIT_SCHEMA_VERSION = '1.0.0';
export const PROFILE_NAMES = Object.freeze([
  'snapshot',
  'security',
  'architecture',
  'maintainability',
  'updates',
  'best-practices',
]);
export const FAIL_ON_LEVELS = Object.freeze([
  'none',
  'info',
  'low',
  'medium',
  'high',
  'critical',
]);

const EXPECTED_REPOSITORY_NAME = 'wsm-antigravity';
const MAX_TEXT_FILE_BYTES = 1_000_000;
const MAX_FINDINGS_PER_PROFILE = 250;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.css', '.html', '.js', '.jsx', '.mjs', '.scss', '.ts', '.tsx']);
const TEXT_EXTENSIONS = new Set([
  ...SOURCE_EXTENSIONS,
  '.json',
  '.md',
  '.sql',
  '.toml',
  '.yaml',
  '.yml',
]);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.pnpm-store',
  'coverage',
  'dist',
  'dist-ssr',
  'logs',
  'node_modules',
  'playwright-report',
  'test-results',
  'uploads',
]);
const SECRET_KEY_PATTERN = /(?:authorization|cookie|credential|passwd|password|private[_-]?key|secret|token|api[_-]?key)/i;
const SECRET_FILE_PATTERN = /(?:^|\/)(?:\.env(?:\..+)?|.*\.(?:key|p12|pfx|pem)|credentials?(?:\..+)?|secrets?(?:\..+)?)$/i;
const TEST_FILE_PATTERN = /(?:^|\/)(?:__tests__|e2e|test|tests)(?:\/|$)|\.(?:e2e|spec|test)\.[cm]?[jt]sx?$/i;
const SEVERITY_RANK = Object.freeze({ info: 1, low: 2, medium: 3, high: 4, critical: 5 });
const SCORE_DEDUCTION = Object.freeze({ info: 0, low: 2, medium: 6, high: 12, critical: 25 });
const IMPORT_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'];

export class AuditInputError extends Error {
  constructor(message, code = 'INVALID_AUDIT_INPUT') {
    super(message);
    this.name = 'AuditInputError';
    this.code = code;
  }
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function readJsonFile(filePath, label) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    throw new AuditInputError(`No se pudo leer ${label}.`, 'UNREADABLE_REPOSITORY_METADATA');
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new AuditInputError(`${label} no contiene JSON valido.`, 'INVALID_REPOSITORY_METADATA');
  }
}

export async function validateWorkspace(workspacePath) {
  if (typeof workspacePath !== 'string' || workspacePath.trim() === '') {
    throw new AuditInputError('workspace_path es obligatorio y debe ser una ruta no vacia.');
  }

  const requestedPath = path.resolve(workspacePath);
  let root;
  try {
    const metadata = await lstat(requestedPath);
    if (!metadata.isDirectory()) {
      throw new AuditInputError('workspace_path debe apuntar a un directorio.');
    }
    root = await realpath(requestedPath);
    await access(path.join(root, 'package.json'), fsConstants.R_OK);
    await access(path.join(root, '.git'), fsConstants.R_OK);
  } catch (error) {
    if (error instanceof AuditInputError) throw error;
    throw new AuditInputError('workspace_path no es un repositorio WSM accesible.', 'WORKSPACE_NOT_ACCESSIBLE');
  }

  const packageJson = await readJsonFile(path.join(root, 'package.json'), 'package.json');
  if (packageJson?.name !== EXPECTED_REPOSITORY_NAME) {
    throw new AuditInputError(
      `El repositorio debe identificarse como ${EXPECTED_REPOSITORY_NAME}.`,
      'UNEXPECTED_REPOSITORY',
    );
  }

  return { root, packageJson };
}

async function listRepositoryFiles(root) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (!isWithinRoot(root, absolute)) continue;
      const relative = toPosix(path.relative(root, absolute));

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(absolute);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  }

  await visit(root);
  return files;
}

function isSecretBearingFile(relativePath) {
  if (/\.env\.example$/i.test(relativePath)) return true;
  return SECRET_FILE_PATTERN.test(relativePath);
}

function isReadableTextFile(relativePath) {
  if (isSecretBearingFile(relativePath)) return false;
  const extension = path.posix.extname(relativePath).toLowerCase();
  const baseName = path.posix.basename(relativePath).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || ['dockerfile', 'makefile'].includes(baseName);
}

async function loadTextRecords(root, files) {
  const records = [];

  for (const relativePath of files) {
    if (!isReadableTextFile(relativePath)) continue;
    const absolutePath = path.join(root, ...relativePath.split('/'));
    let metadata;
    try {
      metadata = await stat(absolutePath);
    } catch {
      continue;
    }
    if (metadata.size > MAX_TEXT_FILE_BYTES) continue;

    try {
      const text = await readFile(absolutePath, 'utf8');
      if (text.includes('\0')) continue;
      records.push({
        path: relativePath,
        extension: path.posix.extname(relativePath).toLowerCase(),
        lines: text.split(/\r?\n/),
      });
    } catch {
      // A transiently unreadable source file is omitted; no content or OS error is exposed.
    }
  }

  return records;
}

function runGit(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 5_000,
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function gitContext(root) {
  const branch = runGit(root, ['branch', '--show-current']);
  const commit = runGit(root, ['rev-parse', '--short=12', 'HEAD']);
  const statusOutput = runGit(root, ['status', '--porcelain=v1', '-uno']);
  return {
    branch: branch || null,
    commit: commit || null,
    dirty_tracked_files: statusOutput ? statusOutput.split(/\r?\n/).filter(Boolean).length : 0,
  };
}

function trackedFileSet(root) {
  const output = runGit(root, ['ls-files', '-z']);
  if (!output) return new Set();
  return new Set(output.split('\0').filter(Boolean).map((item) => toPosix(item)));
}

async function loadManifests(root, files, rootPackageJson) {
  const manifestPaths = files.filter((file) => file === 'package.json' || file.endsWith('/package.json'));
  const manifests = [];

  for (const manifestPath of manifestPaths) {
    let manifest;
    if (manifestPath === 'package.json') {
      manifest = rootPackageJson;
    } else {
      try {
        manifest = JSON.parse(await readFile(path.join(root, ...manifestPath.split('/')), 'utf8'));
      } catch {
        continue;
      }
    }

    manifests.push({
      path: manifestPath,
      name: typeof manifest.name === 'string' ? manifest.name : null,
      version: typeof manifest.version === 'string' ? manifest.version : null,
      private: manifest.private === true,
      scripts: manifest.scripts && typeof manifest.scripts === 'object' ? manifest.scripts : {},
      dependencies: manifest.dependencies && typeof manifest.dependencies === 'object' ? manifest.dependencies : {},
      devDependencies: manifest.devDependencies && typeof manifest.devDependencies === 'object' ? manifest.devDependencies : {},
      peerDependencies: manifest.peerDependencies && typeof manifest.peerDependencies === 'object' ? manifest.peerDependencies : {},
      engines: manifest.engines && typeof manifest.engines === 'object' ? manifest.engines : {},
      packageManager: typeof manifest.packageManager === 'string' ? manifest.packageManager : null,
    });
  }

  return manifests.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

function summarizeLanguages(files) {
  const names = new Map([
    ['.js', 'JavaScript'],
    ['.jsx', 'JavaScript JSX'],
    ['.mjs', 'JavaScript ESM'],
    ['.cjs', 'JavaScript CommonJS'],
    ['.ts', 'TypeScript'],
    ['.tsx', 'TypeScript JSX'],
    ['.css', 'CSS'],
    ['.scss', 'SCSS'],
    ['.sql', 'SQL'],
  ]);
  const counts = {};
  for (const file of files) {
    const language = names.get(path.posix.extname(file).toLowerCase());
    if (language) counts[language] = (counts[language] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right, 'en')));
}

async function buildContext(workspacePath) {
  const { root, packageJson } = await validateWorkspace(workspacePath);
  const files = await listRepositoryFiles(root);
  const [records, manifests] = await Promise.all([
    loadTextRecords(root, files),
    loadManifests(root, files, packageJson),
  ]);
  const sourceFiles = files.filter((file) => SOURCE_EXTENSIONS.has(path.posix.extname(file).toLowerCase()));
  const tests = sourceFiles.filter((file) => TEST_FILE_PATTERN.test(file));

  return {
    root,
    packageJson,
    files,
    records,
    manifests,
    sourceFiles,
    tests,
    trackedFiles: trackedFileSet(root),
    repository: {
      name: EXPECTED_REPOSITORY_NAME,
      version: typeof packageJson.version === 'string' ? packageJson.version : null,
      workspace_path: root,
      git: gitContext(root),
    },
  };
}

class ProfileCollector {
  constructor(profile) {
    this.profile = profile;
    this.findings = [];
    this.checks = [];
    this.omittedFindings = 0;
  }

  finding(rule, severity, title, recommendation, location = null, metadata = null) {
    if (!SEVERITY_RANK[severity]) throw new Error(`Invalid severity for ${rule}`);
    if (this.findings.length >= MAX_FINDINGS_PER_PROFILE) {
      this.omittedFindings += 1;
      return;
    }
    this.findings.push({ rule, severity, title, recommendation, location, metadata });
  }

  check(id, status, title, metadata = null) {
    this.checks.push({ id, status, title, metadata });
  }

  finish(data = null, limitations = []) {
    const ordered = [...this.findings].sort((left, right) => {
      const severityDifference = SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
      if (severityDifference !== 0) return severityDifference;
      const ruleDifference = left.rule.localeCompare(right.rule, 'en');
      if (ruleDifference !== 0) return ruleDifference;
      const pathDifference = (left.location?.path ?? '').localeCompare(right.location?.path ?? '', 'en');
      if (pathDifference !== 0) return pathDifference;
      return (left.location?.line ?? 0) - (right.location?.line ?? 0);
    }).map((finding, index) => ({
      id: `${this.profile}-${finding.rule}-${String(index + 1).padStart(3, '0')}`,
      ...finding,
    }));

    const counts = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
    for (const finding of ordered) counts[finding.severity] += 1;
    const highestSeverity = [...Object.keys(SEVERITY_RANK)]
      .reverse()
      .find((severity) => counts[severity] > 0) ?? 'none';
    const score = Math.max(
      0,
      Math.round(100 - ordered.reduce((total, finding) => total + SCORE_DEDUCTION[finding.severity], 0)),
    );

    return {
      profile: this.profile,
      summary: {
        score,
        status: counts.critical > 0 || counts.high > 0 ? 'action-required' : counts.medium > 0 ? 'review' : 'healthy',
        highest_severity: highestSeverity,
        findings_total: ordered.length,
        findings_omitted: this.omittedFindings,
        findings_by_severity: counts,
        checks_total: this.checks.length,
        checks_passed: this.checks.filter((check) => check.status === 'pass').length,
      },
      checks: this.checks.sort((left, right) => left.id.localeCompare(right.id, 'en')),
      findings: ordered,
      data,
      limitations,
    };
  }
}

function auditSnapshot(context) {
  const collector = new ProfileCollector('snapshot');
  collector.check('repository-identity', 'pass', 'Identidad del repositorio validada');
  collector.check('read-only-snapshot', 'pass', 'Snapshot generado sin modificar el workspace');

  const topLevelDirectories = [...new Set(
    context.files.filter((file) => file.includes('/')).map((file) => file.split('/')[0]),
  )].sort((left, right) => left.localeCompare(right, 'en'));
  const environmentFiles = context.files.filter((file) => /(?:^|\/)\.env(?:\.|$)/i.test(file));

  return collector.finish({
    repository: context.repository,
    files: {
      total: context.files.length,
      source: context.sourceFiles.length,
      tests: context.tests.length,
      migrations: context.files.filter((file) => /(?:^|\/)migrations?\//i.test(file)).length,
    },
    languages: summarizeLanguages(context.files),
    packages: context.manifests.map((manifest) => ({
      path: manifest.path,
      name: manifest.name,
      version: manifest.version,
      private: manifest.private,
      script_names: Object.keys(manifest.scripts).sort((left, right) => left.localeCompare(right, 'en')),
    })),
    top_level_directories: topLevelDirectories,
    environment_file_names: environmentFiles,
  });
}

function firstMatchingLine(lines, pattern) {
  for (let index = 0; index < lines.length; index += 1) {
    pattern.lastIndex = 0;
    if (pattern.test(lines[index])) return index + 1;
  }
  return null;
}

function countMatchingLines(lines, pattern) {
  let count = 0;
  let firstLine = null;
  for (let index = 0; index < lines.length; index += 1) {
    pattern.lastIndex = 0;
    if (pattern.test(lines[index])) {
      count += 1;
      firstLine ??= index + 1;
    }
  }
  return { count, firstLine };
}

function auditSecurity(context) {
  const collector = new ProfileCollector('security');
  const sensitiveFiles = context.files.filter(isSecretBearingFile);
  const trackedSensitive = sensitiveFiles.filter((file) => context.trackedFiles.has(file));
  const gitignoreRecord = context.records.find((record) => record.path === '.gitignore');
  const ignoresEnvironment = gitignoreRecord?.lines.some((line) => /^\s*\.env(?:\.\*|\s|$)/.test(line)) ?? false;

  collector.check(
    'environment-ignore-policy',
    ignoresEnvironment ? 'pass' : 'fail',
    ignoresEnvironment ? 'Los archivos de entorno estan cubiertos por .gitignore' : 'Falta una regla de exclusion para archivos de entorno',
  );
  collector.check(
    'tracked-secret-files',
    trackedSensitive.length === 0 ? 'pass' : 'fail',
    trackedSensitive.length === 0 ? 'No se detectaron archivos sensibles versionados' : 'Se detectaron archivos sensibles versionados',
    { count: trackedSensitive.length },
  );

  for (const file of trackedSensitive) {
    collector.finding(
      'tracked-sensitive-file',
      'critical',
      'Archivo potencialmente sensible bajo control de versiones',
      'Retirar el archivo del historial, rotar sus credenciales y conservar solo una plantilla sin valores.',
      { path: file },
    );
  }

  const hardcodedSecretPattern = /(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\s*[:=]\s*["'`](?!\s*(?:process\.env|import\.meta\.env|example|sample|test|changeme|\[redacted\]))[^"'`]{8,}["'`]/i;
  const riskyPatterns = [
    {
      rule: 'dynamic-code-execution',
      severity: 'high',
      pattern: /\b(?:eval\s*\(|new\s+Function\s*\()/,
      title: 'Ejecucion dinamica de codigo detectada',
      recommendation: 'Eliminar la evaluacion dinamica o aislarla tras una validacion estricta y pruebas de abuso.',
    },
    {
      rule: 'wildcard-cors',
      severity: 'high',
      pattern: /(?:origin|access-control-allow-origin)\s*[:=]\s*["'`]\*["'`]/i,
      title: 'Politica CORS comodin detectada',
      recommendation: 'Restringir los origenes a una lista explicita por ambiente.',
    },
    {
      rule: 'raw-html-rendering',
      severity: 'medium',
      pattern: /dangerouslySetInnerHTML/,
      title: 'Renderizado de HTML sin escape detectado',
      recommendation: 'Sanitizar contenido no confiable y justificar el uso con una prueba de seguridad.',
    },
    {
      rule: 'sql-template-interpolation',
      severity: 'high',
      pattern: /(?:query|execute)\s*\(\s*`[^`]*\$\{/i,
      title: 'Interpolacion directa en una consulta SQL',
      recommendation: 'Usar parametros vinculados en todas las consultas.',
    },
  ];

  for (const record of context.records) {
    if (!SOURCE_EXTENSIONS.has(record.extension)) continue;
    const secretLine = firstMatchingLine(record.lines, hardcodedSecretPattern);
    if (secretLine !== null) {
      collector.finding(
        'hardcoded-secret',
        'critical',
        'Posible secreto escrito directamente en codigo',
        'Mover el valor a un gestor de secretos, rotarlo y agregar una prueba preventiva.',
        { path: record.path, line: secretLine },
      );
    }

    for (const risk of riskyPatterns) {
      const line = firstMatchingLine(record.lines, risk.pattern);
      if (line !== null) {
        collector.finding(risk.rule, risk.severity, risk.title, risk.recommendation, { path: record.path, line });
      }
    }
  }

  const lockfilePresent = context.files.includes('package-lock.json');
  collector.check(
    'dependency-lockfile',
    lockfilePresent ? 'pass' : 'fail',
    lockfilePresent ? 'Existe lockfile de dependencias' : 'No existe lockfile de dependencias',
  );
  if (!lockfilePresent) {
    collector.finding(
      'missing-lockfile',
      'high',
      'Dependencias sin lockfile reproducible',
      'Versionar un lockfile y usar instalaciones reproducibles en CI.',
    );
  }

  return collector.finish(
    {
      sensitive_file_names_detected: sensitiveFiles,
      sensitive_files_tracked: trackedSensitive.length,
      source_files_scanned: context.records.filter((record) => SOURCE_EXTENSIONS.has(record.extension)).length,
    },
    ['El perfil local no consulta una base de vulnerabilidades ni realiza pruebas de penetracion.'],
  );
}

function extractImportSpecifiers(lines) {
  const specifiers = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*["'`]([^"'`]+)["'`]/g;
  for (let index = 0; index < lines.length; index += 1) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(lines[index])) !== null) {
      specifiers.push({ specifier: match[1], line: index + 1 });
    }
  }
  return specifiers;
}

function packageRootFor(relativePath) {
  const match = relativePath.match(/^(packages\/[^/]+)\//);
  return match?.[1] ?? null;
}

function resolveLocalImport(sourcePath, specifier, sourceSet) {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier));
  const candidates = [base];
  for (const extension of IMPORT_EXTENSIONS) candidates.push(`${base}${extension}`);
  for (const extension of IMPORT_EXTENSIONS) candidates.push(`${base}/index${extension}`);
  return candidates.find((candidate) => sourceSet.has(candidate)) ?? null;
}

function stronglyConnectedComponents(graph) {
  let nextIndex = 0;
  const indexByNode = new Map();
  const lowLink = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  function connect(node) {
    indexByNode.set(node, nextIndex);
    lowLink.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const adjacent of graph.get(node) ?? []) {
      if (!indexByNode.has(adjacent)) {
        connect(adjacent);
        lowLink.set(node, Math.min(lowLink.get(node), lowLink.get(adjacent)));
      } else if (onStack.has(adjacent)) {
        lowLink.set(node, Math.min(lowLink.get(node), indexByNode.get(adjacent)));
      }
    }

    if (lowLink.get(node) === indexByNode.get(node)) {
      const component = [];
      let current;
      do {
        current = stack.pop();
        onStack.delete(current);
        component.push(current);
      } while (current !== node);
      components.push(component.sort((left, right) => left.localeCompare(right, 'en')));
    }
  }

  for (const node of [...graph.keys()].sort((left, right) => left.localeCompare(right, 'en'))) {
    if (!indexByNode.has(node)) connect(node);
  }
  return components;
}

function auditArchitecture(context) {
  const collector = new ProfileCollector('architecture');
  const sourceSet = new Set(context.sourceFiles);
  const graph = new Map(context.sourceFiles.map((file) => [file, new Set()]));
  let crossPackageRelativeImports = 0;

  for (const record of context.records) {
    if (!sourceSet.has(record.path)) continue;
    const sourcePackage = packageRootFor(record.path);
    for (const imported of extractImportSpecifiers(record.lines)) {
      const target = resolveLocalImport(record.path, imported.specifier, sourceSet);
      if (target) graph.get(record.path)?.add(target);

      const normalizedTarget = path.posix.normalize(path.posix.join(path.posix.dirname(record.path), imported.specifier));
      const targetPackage = packageRootFor(normalizedTarget);
      if (imported.specifier.startsWith('.') && sourcePackage && targetPackage && sourcePackage !== targetPackage) {
        crossPackageRelativeImports += 1;
        collector.finding(
          'cross-package-relative-import',
          'high',
          'Importacion relativa atraviesa el limite de un workspace',
          'Consumir la API publica del paquete para preservar sus limites arquitectonicos.',
          { path: record.path, line: imported.line },
        );
      }
    }
  }

  const cycles = stronglyConnectedComponents(graph).filter((component) => component.length > 1);
  for (const cycle of cycles.slice(0, 30)) {
    collector.finding(
      'dependency-cycle',
      'medium',
      'Ciclo de dependencias entre modulos',
      'Extraer el contrato compartido o invertir la dependencia para romper el ciclo.',
      { path: cycle[0] },
      { modules_in_cycle: cycle.length },
    );
  }

  const packageNames = new Set(context.manifests.map((manifest) => manifest.name).filter(Boolean));
  const hasCommonPackage = packageNames.has('@wsm/common');
  collector.check(
    'shared-contract-package',
    hasCommonPackage ? 'pass' : 'warn',
    hasCommonPackage ? 'Existe un paquete compartido para contratos' : 'No se detecto el paquete compartido esperado',
  );
  collector.check(
    'workspace-boundaries',
    crossPackageRelativeImports === 0 ? 'pass' : 'fail',
    crossPackageRelativeImports === 0 ? 'No hay imports relativos entre workspaces' : 'Hay imports relativos entre workspaces',
    { count: crossPackageRelativeImports },
  );

  const versionsByDependency = new Map();
  for (const manifest of context.manifests) {
    for (const [dependency, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
      if (!versionsByDependency.has(dependency)) versionsByDependency.set(dependency, new Map());
      const occurrences = versionsByDependency.get(dependency);
      if (!occurrences.has(version)) occurrences.set(version, []);
      occurrences.get(version).push(manifest.path);
    }
  }
  for (const [dependency, versions] of [...versionsByDependency].sort(([left], [right]) => left.localeCompare(right, 'en'))) {
    if (versions.size > 1) {
      collector.finding(
        'dependency-version-drift',
        'low',
        'Versiones divergentes de una dependencia entre workspaces',
        'Alinear la version declarada o documentar por que cada workspace requiere una diferente.',
        null,
        { dependency, declared_versions: [...versions.keys()].sort() },
      );
    }
  }

  return collector.finish({
    workspaces: context.manifests.filter((manifest) => manifest.path !== 'package.json').map((manifest) => ({
      path: manifest.path,
      name: manifest.name,
    })),
    dependency_graph: {
      modules: graph.size,
      edges: [...graph.values()].reduce((total, edges) => total + edges.size, 0),
      cycles: cycles.length,
      cross_workspace_relative_imports: crossPackageRelativeImports,
    },
  });
}

function auditMaintainability(context) {
  const collector = new ProfileCollector('maintainability');
  let totalLines = 0;
  let todoCount = 0;
  let consoleCount = 0;
  let lintDisableCount = 0;

  for (const record of context.records) {
    if (!SOURCE_EXTENSIONS.has(record.extension)) continue;
    const lineCount = record.lines.length;
    totalLines += lineCount;
    if (lineCount > 900) {
      collector.finding(
        'oversized-source-file',
        'high',
        'Archivo fuente excesivamente extenso',
        'Separar responsabilidades en modulos cohesionados y cubrir la extraccion con pruebas.',
        { path: record.path },
        { lines: lineCount },
      );
    } else if (lineCount > 500) {
      collector.finding(
        'large-source-file',
        'medium',
        'Archivo fuente extenso',
        'Evaluar una extraccion por responsabilidad antes de agregar nueva logica.',
        { path: record.path },
        { lines: lineCount },
      );
    }

    const todo = countMatchingLines(record.lines, /\b(?:TODO|FIXME|HACK|XXX)\b/i);
    todoCount += todo.count;
    if (todo.count > 0) {
      collector.finding(
        'untracked-code-debt',
        'low',
        'Marcadores de deuda tecnica en codigo',
        'Convertirlos en trabajo trazable o resolverlos; evitar comentarios indefinidos.',
        { path: record.path, line: todo.firstLine },
        { occurrences: todo.count },
      );
    }

    const consoleUsage = countMatchingLines(record.lines, /\bconsole\.(?:debug|log|trace)\s*\(/);
    consoleCount += consoleUsage.count;
    if (consoleUsage.count >= 3 && !TEST_FILE_PATTERN.test(record.path)) {
      collector.finding(
        'ad-hoc-console-logging',
        'low',
        'Uso repetido de logging no estructurado',
        'Canalizar los eventos por el logger del proyecto y aplicar niveles y redaccion.',
        { path: record.path, line: consoleUsage.firstLine },
        { occurrences: consoleUsage.count },
      );
    }

    const lintDisable = countMatchingLines(record.lines, /eslint-disable|@ts-ignore|@ts-nocheck/);
    lintDisableCount += lintDisable.count;
    if (lintDisable.count > 0) {
      collector.finding(
        'static-analysis-suppression',
        'low',
        'Supresion de analisis estatico',
        'Acotar y justificar cada supresion o corregir la causa subyacente.',
        { path: record.path, line: lintDisable.firstLine },
        { occurrences: lintDisable.count },
      );
    }
  }

  const productionSourceCount = context.sourceFiles.filter((file) => !TEST_FILE_PATTERN.test(file)).length;
  const testRatio = productionSourceCount === 0 ? 0 : context.tests.length / productionSourceCount;
  collector.check(
    'test-presence',
    context.tests.length > 0 ? 'pass' : 'fail',
    context.tests.length > 0 ? 'Se detectaron pruebas automatizadas' : 'No se detectaron pruebas automatizadas',
    { test_files: context.tests.length },
  );
  if (productionSourceCount > 20 && testRatio < 0.08) {
    collector.finding(
      'low-test-file-ratio',
      'medium',
      'Baja proporcion de archivos de prueba',
      'Priorizar pruebas de dominio, integracion y regresion en los circuitos criticos.',
      null,
      { source_files: productionSourceCount, test_files: context.tests.length },
    );
  }

  return collector.finish({
    source_files: productionSourceCount,
    test_files: context.tests.length,
    approximate_source_lines: totalLines,
    markers: {
      technical_debt: todoCount,
      console_logging: consoleCount,
      static_analysis_suppressions: lintDisableCount,
    },
  }, ['Los indicadores de tamano y proporcion no reemplazan una revision semantica del codigo.']);
}

async function readLockfileMetadata(context) {
  if (!context.files.includes('package-lock.json')) return null;
  try {
    const lock = JSON.parse(await readFile(path.join(context.root, 'package-lock.json'), 'utf8'));
    const packages = lock.packages && typeof lock.packages === 'object' ? lock.packages : {};
    const deprecated = [];
    let installScripts = 0;
    for (const [packagePath, metadata] of Object.entries(packages)) {
      if (!packagePath || !metadata || typeof metadata !== 'object') continue;
      const packageName = packagePath.replace(/^node_modules\//, '');
      if (metadata.deprecated) deprecated.push(packageName);
      if (metadata.hasInstallScript === true) installScripts += 1;
    }
    return {
      lockfileVersion: Number.isFinite(lock.lockfileVersion) ? lock.lockfileVersion : null,
      deprecated: deprecated.sort((left, right) => left.localeCompare(right, 'en')),
      installScripts,
    };
  } catch {
    return { invalid: true, lockfileVersion: null, deprecated: [], installScripts: 0 };
  }
}

async function auditUpdates(context) {
  const collector = new ProfileCollector('updates');
  const lock = await readLockfileMetadata(context);
  collector.check(
    'lockfile-health',
    lock && !lock.invalid ? 'pass' : 'fail',
    lock && !lock.invalid ? 'Lockfile legible y disponible' : 'Lockfile ausente o invalido',
  );

  if (!lock || lock.invalid) {
    collector.finding(
      'invalid-or-missing-lockfile',
      'high',
      'No hay un lockfile utilizable',
      'Regenerar y versionar el lockfile con la version de Node aprobada.',
    );
  } else if (lock.lockfileVersion !== null && lock.lockfileVersion < 3) {
    collector.finding(
      'legacy-lockfile',
      'medium',
      'Formato de lockfile antiguo',
      'Actualizarlo de forma controlada y validar build, pruebas y despliegue.',
      null,
      { lockfile_version: lock.lockfileVersion },
    );
  }

  for (const packageName of lock?.deprecated.slice(0, 100) ?? []) {
    collector.finding(
      'deprecated-installed-package',
      'medium',
      'Paquete instalado marcado como obsoleto',
      'Reemplazarlo o actualizar la dependencia que lo incorpora y ejecutar la regresion completa.',
      null,
      { package: packageName },
    );
  }

  let unboundedRanges = 0;
  let floatingRanges = 0;
  for (const manifest of context.manifests) {
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
    for (const [dependency, declaredVersion] of Object.entries(dependencies)) {
      const value = String(declaredVersion).trim();
      if (/^(?:\*|latest|next|https?:|git(?:\+|:)|github:)/i.test(value)) {
        unboundedRanges += 1;
        collector.finding(
          'unbounded-dependency-source',
          'high',
          'Dependencia con origen o version no reproducible',
          'Fijar una version publicada y conservar su integridad en el lockfile.',
          { path: manifest.path },
          { dependency },
        );
      } else if (/^[~^]|(?:^|\.)[xX*](?:\.|$)/.test(value)) {
        floatingRanges += 1;
      }
    }
  }
  if (floatingRanges > 0) {
    collector.finding(
      'floating-version-ranges',
      'low',
      'Rangos de version flotantes en manifiestos',
      'Conservar el lockfile y automatizar actualizaciones pequenas con pruebas y revision.',
      null,
      { declarations: floatingRanges },
    );
  }

  const rootManifest = context.manifests.find((manifest) => manifest.path === 'package.json');
  if (!rootManifest?.engines?.node) {
    collector.finding(
      'missing-node-engine-policy',
      'low',
      'Version de Node no declarada',
      'Declarar engines.node y usar la misma linea en desarrollo, CI y produccion.',
      { path: 'package.json' },
    );
  }

  return collector.finish({
    manifests_scanned: context.manifests.length,
    lockfile_version: lock?.lockfileVersion ?? null,
    deprecated_packages: lock?.deprecated.length ?? 0,
    packages_with_install_scripts: lock?.installScripts ?? 0,
    unbounded_declarations: unboundedRanges,
    floating_declarations: floatingRanges,
  }, [
    'Este perfil es offline: no afirma que una dependencia este actualizada ni consulta advisories externos.',
    'Antes de actualizar se requieren changelog, compatibilidad, pruebas y plan de reversa.',
  ]);
}

function auditBestPractices(context) {
  const collector = new ProfileCollector('best-practices');
  const rootManifest = context.manifests.find((manifest) => manifest.path === 'package.json');
  const requiredScripts = ['build', 'lint', 'test', 'typecheck', 'validate'];

  for (const script of requiredScripts) {
    const present = typeof rootManifest?.scripts?.[script] === 'string';
    collector.check(
      `root-script-${script}`,
      present ? 'pass' : 'fail',
      present ? `Existe el script raiz ${script}` : `Falta el script raiz ${script}`,
    );
    if (!present) {
      collector.finding(
        'missing-quality-script',
        script === 'test' || script === 'validate' ? 'medium' : 'low',
        'Falta una puerta de calidad estandarizada',
        `Agregar el script ${script} y ejecutarlo en CI.`,
        { path: 'package.json' },
        { script },
      );
    }
  }

  const workflowFiles = context.files.filter((file) => /^\.github\/workflows\/.*\.ya?ml$/i.test(file));
  collector.check(
    'continuous-integration',
    workflowFiles.length > 0 ? 'pass' : 'fail',
    workflowFiles.length > 0 ? 'Se detecto integracion continua' : 'No se detecto integracion continua',
    { workflows: workflowFiles.length },
  );
  if (workflowFiles.length === 0) {
    collector.finding(
      'missing-ci',
      'high',
      'Repositorio sin workflow de integracion continua',
      'Ejecutar lint, tipos, pruebas, build y controles de seguridad en cada cambio.',
    );
  }

  const hasEnvironmentTemplate = context.files.some((file) => /(?:^|\/)\.env\.example$/i.test(file));
  collector.check(
    'environment-template',
    hasEnvironmentTemplate ? 'pass' : 'warn',
    hasEnvironmentTemplate ? 'Existe una plantilla de variables de entorno' : 'Falta una plantilla de variables de entorno',
  );
  if (!hasEnvironmentTemplate) {
    collector.finding(
      'missing-environment-template',
      'low',
      'Variables de entorno sin plantilla versionada',
      'Agregar una plantilla solo con nombres y valores ficticios no sensibles.',
    );
  }

  const tsconfigRecords = context.records.filter((record) => /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/i.test(record.path));
  const nonStrictConfigs = tsconfigRecords.filter((record) => !record.lines.some((line) => /"strict"\s*:\s*true/.test(line)));
  collector.check(
    'typescript-strictness',
    nonStrictConfigs.length === 0 && tsconfigRecords.length > 0 ? 'pass' : 'warn',
    nonStrictConfigs.length === 0 && tsconfigRecords.length > 0
      ? 'Las configuraciones TypeScript declaran modo estricto'
      : 'Hay configuraciones TypeScript sin modo estricto explicito',
    { configs: tsconfigRecords.length, non_strict: nonStrictConfigs.length },
  );
  for (const record of nonStrictConfigs) {
    collector.finding(
      'typescript-strict-not-explicit',
      'low',
      'Configuracion TypeScript sin strict explicito',
      'Activar strict gradualmente y corregir los errores por dominio.',
      { path: record.path },
    );
  }

  const migrations = context.files.filter((file) => /(?:^|\/)migrations?\/.*\.(?:js|sql|ts)$/i.test(file));
  const testsPresent = context.tests.length > 0;
  collector.check(
    'database-migrations',
    migrations.length > 0 ? 'pass' : 'warn',
    migrations.length > 0 ? 'Se detectaron migraciones versionadas' : 'No se detectaron migraciones versionadas',
    { migrations: migrations.length },
  );
  collector.check(
    'automated-tests',
    testsPresent ? 'pass' : 'fail',
    testsPresent ? 'Se detectaron pruebas automatizadas' : 'No se detectaron pruebas automatizadas',
    { test_files: context.tests.length },
  );

  const validationDependencies = new Set(['@hapi/joi', 'express-validator', 'joi', 'valibot', 'yup', 'zod']);
  const usesValidationLibrary = context.manifests.some((manifest) =>
    Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).some((dependency) => validationDependencies.has(dependency)),
  );
  collector.check(
    'runtime-input-validation',
    usesValidationLibrary ? 'pass' : 'warn',
    usesValidationLibrary ? 'Se detecto validacion declarativa de entradas' : 'No se detecto una libreria declarativa de validacion',
  );

  return collector.finish({
    root_quality_scripts: requiredScripts.filter((script) => typeof rootManifest?.scripts?.[script] === 'string'),
    workflows: workflowFiles,
    typescript_configs: tsconfigRecords.length,
    migrations: migrations.length,
    test_files: context.tests.length,
  }, ['Los checks confirman presencia y configuracion basica; no certifican el resultado de ejecutar las puertas de calidad.']);
}

const PROFILE_RUNNERS = Object.freeze({
  snapshot: async (context) => auditSnapshot(context),
  security: async (context) => auditSecurity(context),
  architecture: async (context) => auditArchitecture(context),
  maintainability: async (context) => auditMaintainability(context),
  updates: async (context) => auditUpdates(context),
  'best-practices': async (context) => auditBestPractices(context),
});

function normalizeProfiles(profiles) {
  const requested = Array.isArray(profiles) ? profiles : [profiles ?? 'all'];
  const expanded = requested.flatMap((profile) => String(profile).split(',')).map((profile) => profile.trim()).filter(Boolean);
  const normalized = expanded.includes('all') ? [...PROFILE_NAMES] : [...new Set(expanded)];
  const invalid = normalized.filter((profile) => !PROFILE_NAMES.includes(profile));
  if (invalid.length > 0) {
    throw new AuditInputError(`Perfil de auditoria no reconocido: ${invalid.join(', ')}.`, 'UNKNOWN_AUDIT_PROFILE');
  }
  return normalized;
}

function aggregateReports(reports) {
  const counts = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (const report of reports) {
    for (const [severity, count] of Object.entries(report.summary.findings_by_severity)) counts[severity] += count;
  }
  const highestSeverity = [...Object.keys(SEVERITY_RANK)]
    .reverse()
    .find((severity) => counts[severity] > 0) ?? 'none';
  return {
    score: reports.length === 0
      ? 100
      : Math.round(reports.reduce((total, report) => total + report.summary.score, 0) / reports.length),
    status: counts.critical > 0 || counts.high > 0 ? 'action-required' : counts.medium > 0 ? 'review' : 'healthy',
    highest_severity: highestSeverity,
    findings_total: Object.values(counts).reduce((total, count) => total + count, 0),
    findings_by_severity: counts,
  };
}

export async function runAudit({ workspacePath, profiles = ['all'] }) {
  const selectedProfiles = normalizeProfiles(profiles);
  const context = await buildContext(workspacePath);
  const reports = [];
  for (const profile of selectedProfiles) reports.push(await PROFILE_RUNNERS[profile](context));

  return sanitizeForOutput({
    schema_version: AUDIT_SCHEMA_VERSION,
    repository: context.repository,
    profiles: reports,
    aggregate: aggregateReports(reports),
  });
}

export function validateFailOn(failOn) {
  const normalized = String(failOn ?? 'none').toLowerCase();
  if (!FAIL_ON_LEVELS.includes(normalized)) {
    throw new AuditInputError(`--fail-on debe ser uno de: ${FAIL_ON_LEVELS.join(', ')}.`, 'INVALID_FAIL_THRESHOLD');
  }
  return normalized;
}

export function shouldFailAtSeverity(report, failOn = 'none') {
  const threshold = validateFailOn(failOn);
  if (threshold === 'none') return false;
  return Object.entries(report.aggregate?.findings_by_severity ?? {}).some(
    ([severity, count]) => count > 0 && SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold],
  );
}

function redactString(value) {
  return value
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/[^/:\s]+:)[^@/\s]+@/gi, '$1[REDACTED]@')
    .replace(/((?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED PEM]')
    .replace(/\b(?:gh[oprsu]_[A-Za-z0-9_]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]');
}

export function sanitizeForOutput(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => sanitizeForOutput(item, seen));
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : sanitizeForOutput(child, seen);
  }
  return output;
}

export function formatAuditText(report) {
  const lines = [
    `WSM audit ${report.schema_version}`,
    `Repository: ${report.repository.name}`,
    `Score: ${report.aggregate.score}/100`,
    `Status: ${report.aggregate.status}`,
    `Findings: ${report.aggregate.findings_total}`,
  ];
  for (const profile of report.profiles) {
    lines.push('', `[${profile.profile}] ${profile.summary.score}/100 - ${profile.summary.findings_total} finding(s)`);
    for (const finding of profile.findings) {
      const location = finding.location?.path
        ? ` (${finding.location.path}${finding.location.line ? `:${finding.location.line}` : ''})`
        : '';
      lines.push(`- ${finding.severity.toUpperCase()} ${finding.id}: ${finding.title}${location}`);
    }
  }
  return redactString(lines.join('\n'));
}
