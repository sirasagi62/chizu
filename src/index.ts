#!/usr/bin/env node
import { createParserFactory, readDirectoryAndChunk, type Options } from "code-chopper";
import path from "path";
import fs from "fs";
import { Command } from "commander";
import ignore from "ignore";

const program = new Command();

program
  .name("chizu")
  .description("Aider-like repository entity mapper")
  .argument("[directory]", "Directory to map", ".")
  .option("-c, --compress", "Compress mode (only show signatures/first lines)", false)
  // --- 検索オプションの追加 ---
  .option("-q, --query <pattern>", "Search for a specific keyword in entities")
  .option("-i, --ignore-case", "Ignore case distinctions", false)
  .action(async (directory, options) => {
    const targetPath = path.resolve(process.cwd(), directory);

    if (!fs.existsSync(targetPath)) {
      console.error(`Error: Directory "${targetPath}" does not exist.`);
      process.exit(1);
    }

    const ig = ignore();
    const gitignorePath = path.join(targetPath, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      ig.add(fs.readFileSync(gitignorePath, "utf-8"));
    }
    ig.add([".git/**", "node_modules/**", "dist/**"]);

    const factory = createParserFactory();

    const chopperOptions: Options = {
      filter: (_, node) => {
        if (node && node.type.includes("import")) {
          return false;
        }
        return true;
      }
    };

    const res = await readDirectoryAndChunk(factory, chopperOptions, targetPath);

    const eachIndent = '  ';
    const indentFormat = (str: string, indentLevel: number): string => {
      return str.split('\n').map((line, i) =>
        i === 0 ? "|" + eachIndent.repeat(indentLevel) + line : "|" + line
      ).join('\n');
    };

    // 検索用正規表現の準備
    let searchRegex: RegExp | null = null;
    if (options.query) {
      searchRegex = new RegExp(options.query, options.ignoreCase ? "i" : "");
    }

    // ファイルごとにチャンクをグループ化して処理
    const filesMap = new Map<string, any[]>();
    res.forEach(r => {
      const filePath = r.filePath || "unknown";
      if (!filesMap.has(filePath)) {
        filesMap.set(filePath, []);
      }
      filesMap.get(filePath)!.push(r);
    });

    filesMap.forEach((chunks, filePath) => {
      const relativeFilePath = path.relative(targetPath, filePath);

      // 検索クエリがある場合、条件に合うチャンクがあるか先にチェック
      const filteredChunks = searchRegex
        ? chunks.filter(r => searchRegex!.test(r.content) || (r.boundary.docs && searchRegex!.test(r.boundary.docs)))
        : chunks;

      // 該当するチャンクが1つもない場合は、ファイル名ごとスキップ
      if (filteredChunks.length === 0) return;

      // ファイル名の出力
      console.log("\n" + relativeFilePath + ":");
      if (!options.compress) console.log("|...");

      filteredChunks.forEach(r => {
        // ドキュメントの表示
        if (!options.compress && r.boundary.docs) {
          console.log(indentFormat(r.boundary.docs, r.boundary.parent?.length ?? 0));
        }

        const content = r.content.split("\n");
        const indentLevel = r.boundary?.parent?.length ?? 0;

        // エンティティの表示
        console.log("|" + eachIndent.repeat(indentLevel) + content[0]);

        if (!options.compress && content.length > 1) {
          console.log("|" + eachIndent.repeat(indentLevel) + "...");
        }
      });
    });
  });

program.parse();
