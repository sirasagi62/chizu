#!/usr/bin/env node
import { createParserFactory, readFileAndChunk, type Options, type BoundaryChunk, type ParserFactory } from "code-chopper";
import path from "path";
import fs from "fs";
import os from "os";
import { Command } from "commander";
import ignore from "ignore";
import { open, type RootDatabase } from "lmdb";
import xxhash from "xxhash-wasm";
import fg from "fast-glob";
const glob = fg.glob;

// --- 1. Cache Layer (Repository) ---
class CacheRepository {
  private db!: RootDatabase;
  private hasher!: (input: string) => string;

  async init() {
    const cacheDir = path.join(os.homedir(), ".cache", "chizu");
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    this.db = open({
      path: path.join(cacheDir, "cache.db"),
      compression: true,
    });

    const { h64ToString } = await xxhash();
    this.hasher = h64ToString;
  }

  getHash(content: string): string {
    return this.hasher(content);
  }

  getCachedChunks(relativePath: string, currentHash: string): BoundaryChunk[] | null {
    const cached = this.db.get(relativePath);
    if (cached && cached.hash === currentHash) {
      return cached.chunks;
    }
    return null;
  }

  saveChunks(relativePath: string, hash: string, chunks: BoundaryChunk[]) {
    this.db.put(relativePath, { hash, chunks });
  }

  async clear() {
    await this.db.clearAsync();
  }
}

// --- 2. Analysis Layer (Service) ---
class AnalysisService {
  constructor(
    private factory: ParserFactory,
    private cache: CacheRepository,
    private options: Options
  ) { }

  async run(targetPath: string, filePaths: string[], batchSize = 50): Promise<Map<string, BoundaryChunk[]>> {
    const fileMap = new Map<string, BoundaryChunk[]>();

    // 50ファイルずつのバッチ並行処理
    for (let i = 0; i < filePaths.length; i += batchSize) {
      const batch = filePaths.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (filePath) => {
          const relativePath = path.relative(targetPath, filePath);
          const content = await fs.promises.readFile(filePath, "utf-8");
          const hash = this.cache.getHash(content);

          // キャッシュヒット確認
          // worktreeなども考慮してフルパスでハッシュを記録
          let chunks = this.cache.getCachedChunks(filePath, hash);

          if (!chunks) {
            // キャッシュミス：解析実行
            chunks = await readFileAndChunk(this.factory, this.options, targetPath, relativePath);
            this.cache.saveChunks(filePath, hash, chunks);
          }
          return { relativePath, chunks };
        })
      );

      batchResults.forEach(({ relativePath, chunks }) => {
        if (chunks.length > 0) fileMap.set(relativePath, chunks);
      });
    }

    return fileMap;
  }
}

// --- 3. CLI/UI Layer (Presenter) ---
const program = new Command();

program
  .name("chizu")
  .description("High-performance repository entity mapper")
  .argument("[directory]", "Directory to map", ".")
  .option("-c, --compress", "Compress mode (only show signatures)", false)
  .option("-q, --query <pattern>", "Search for a specific keyword")
  .option("-i, --ignore-case", "Ignore case distinctions", false)
  .option("--clear", "Clear cache and exit", false)
  .action(async (directory, options) => {
    const cacheRepo = new CacheRepository();
    await cacheRepo.init();

    if (options.clear) {
      await cacheRepo.clear();
      console.log("Cache cleared.");
      process.exit(0);
    }

    const targetPath = path.resolve(process.cwd(), directory);
    if (!fs.existsSync(targetPath)) {
      console.error(`Error: Directory "${targetPath}" does not exist.`);
      process.exit(1);
    }

    // Gitignore & File Discovery
    const ig = ignore();
    const gitignorePath = path.join(targetPath, ".gitignore");
    if (fs.existsSync(gitignorePath)) ig.add(fs.readFileSync(gitignorePath, "utf-8"));
    ig.add([".git/**", "node_modules/**", "dist/**"]);

    const allFiles = await glob("**/*", { cwd: targetPath, absolute: true, dot: true });
    const targetFiles = allFiles.filter(fp => !ig.ignores(path.relative(targetPath, fp)));

    // Analysis Execution
    const factory = createParserFactory();
    const chopperOptions: Options = {
      filter: (_, node) => !node.type.includes("import")
    };

    const service = new AnalysisService(factory, cacheRepo, chopperOptions);
    const resultsMap = await service.run(targetPath, targetFiles);

    // Filter & Presentation Logic
    const searchRegex = options.query ? new RegExp(options.query, options.ignoreCase ? "i" : "") : null;
    const eachIndent = '  ';

    resultsMap.forEach((chunks, relativePath) => {
      // 検索フィルタリング
      const filteredChunks = searchRegex
        ? chunks.filter(r => searchRegex.test(r.content) || (r.boundary.docs && searchRegex.test(r.boundary.docs)))
        : chunks;

      if (filteredChunks.length === 0) return;

      // 出力整形
      console.log(`\n${relativePath}:`);
      if (!options.compress) console.log("|...");

      filteredChunks.forEach(r => {
        const indentLevel = r.boundary?.parent?.length ?? 0;

        // ドキュメント出力
        if (!options.compress && r.boundary.docs) {
          const docLines = r.boundary.docs.split('\n').map((line, i) =>
            i === 0 ? "|" + eachIndent.repeat(indentLevel) + line : "|" + line
          ).join('\n');
          console.log(docLines);
        }

        // シグネチャ出力
        const firstLine = r.content.split("\n")[0];
        console.log("|" + eachIndent.repeat(indentLevel) + firstLine);

        if (!options.compress && r.content.split("\n").length > 1) {
          console.log("|" + eachIndent.repeat(indentLevel) + "...");
        }
      });
    });

    factory.dispose();
  });

program.parse();
