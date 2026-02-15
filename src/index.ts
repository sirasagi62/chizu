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

const CACHE_ROOT = path.join(os.homedir(), ".cache", "chizu");

// --- 1. Cache Layer (Repository) ---
class CacheRepository {
  private db!: RootDatabase;
  private hasher!: (input: string) => string;

  async init() {
    if (!fs.existsSync(CACHE_ROOT)) fs.mkdirSync(CACHE_ROOT, { recursive: true });

    this.db = open({
      path: path.join(CACHE_ROOT, "cache.db"),
      compression: true,
    });

    const { h64ToString } = await xxhash();
    this.hasher = h64ToString;
  }

  getHash(content: string): string {
    return this.hasher(content);
  }

  getCachedChunks(fullPath: string, currentHash: string): BoundaryChunk[] | null {
    const cached = this.db.get(fullPath);
    if (cached && cached.hash === currentHash) {
      return cached.chunks;
    }
    return null;
  }

  saveChunks(fullPath: string, hash: string, chunks: BoundaryChunk[]) {
    this.db.put(fullPath, { hash, chunks });
  }

  /**
   * 特定のディレクトリ配下のキャッシュのみを削除
   */
  async clearDirectoryCache(dirPath: string) {
    const absolutePrefix = path.resolve(dirPath);
    // LMDBのRangeを使ってPrefix一致するキーを走査削除
    let count = 0;
    for (const { key } of this.db.getRange({ start: absolutePrefix })) {
      if (typeof key === 'string' && key.startsWith(absolutePrefix)) {
        await this.db.remove(key);
        count++;
      } else {
        break; // Prefixが外れたら終了
      }
    }
    return count;
  }

  /**
   * DB全体の削除
   */
  async clearAll() {
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

    for (let i = 0; i < filePaths.length; i += batchSize) {
      const batch = filePaths.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (filePath) => {
          const relativePath = path.relative(targetPath, filePath);
          const content = await fs.promises.readFile(filePath, "utf-8");
          const hash = this.cache.getHash(content);

          // フルパスをキーにしてキャッシュ確認
          let chunks = this.cache.getCachedChunks(filePath, hash);

          if (!chunks) {
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
  .option("--clear", "Clear cache for the target directory", false)
  .option("--clear-all", "Clear ALL caches in the system", false)
  .action(async (directory, options) => {
    const cacheRepo = new CacheRepository();
    await cacheRepo.init();

    const targetPath = path.resolve(process.cwd(), directory);

    // キャッシュ全削除
    if (options.clearAll) {
      await cacheRepo.clearAll();
      console.log(`Successfully cleared all caches from ${CACHE_ROOT}`);
      process.exit(0);
    }

    // 特定ディレクトリのキャッシュ削除
    if (options.clear) {
      const count = await cacheRepo.clearDirectoryCache(targetPath);
      console.log(`Cleared ${count} cached files for: ${targetPath}`);
      process.exit(0);
    }

    if (!fs.existsSync(targetPath)) {
      console.error(`Error: Directory "${targetPath}" does not exist.`);
      process.exit(1);
    }

    const ig = ignore();
    const gitignorePath = path.join(targetPath, ".gitignore");
    if (fs.existsSync(gitignorePath)) ig.add(fs.readFileSync(gitignorePath, "utf-8"));
    ig.add([".git/**", "node_modules/**", "dist/**"]);

    const allFiles = await glob("**/*", { cwd: targetPath, absolute: true, dot: true });
    const targetFiles = allFiles.filter(fp => !ig.ignores(path.relative(targetPath, fp)));

    const factory = createParserFactory();
    const chopperOptions: Options = {
      filter: (_, node) => !node.type.includes("import")
    };

    const service = new AnalysisService(factory, cacheRepo, chopperOptions);
    const resultsMap = await service.run(targetPath, targetFiles);

    const searchRegex = options.query ? new RegExp(options.query, options.ignoreCase ? "i" : "") : null;
    const eachIndent = '  ';

    resultsMap.forEach((chunks, relativePath) => {
      const filteredChunks = searchRegex
        ? chunks.filter(r => searchRegex.test(r.content) || (r.boundary.docs && searchRegex.test(r.boundary.docs)))
        : chunks;

      if (filteredChunks.length === 0) return;

      console.log(`\n${relativePath}:`);
      if (!options.compress) console.log("|...");

      filteredChunks.forEach(r => {
        const indentLevel = r.boundary?.parent?.length ?? 0;

        if (!options.compress && r.boundary.docs) {
          const docLines = r.boundary.docs.split('\n').map((line, i) =>
            i === 0 ? "|" + eachIndent.repeat(indentLevel) + line : "|" + line
          ).join('\n');
          console.log(docLines);
        }

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
