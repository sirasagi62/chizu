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
  .action(async (directory, options) => {
    const targetPath = path.resolve(process.cwd(), directory);

    if (!fs.existsSync(targetPath)) {
      console.error(`Error: Directory "${targetPath}" does not exist.`);
      process.exit(1);
    }

    // --- .gitignore の読み込み設定 ---
    const ig = ignore();
    const gitignorePath = path.join(targetPath, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      ig.add(fs.readFileSync(gitignorePath, "utf-8"));
    }
    // デフォルトで除外したいもの
    ig.add([".git/**", "node_modules/**", "dist/**"]);

    const factory = createParserFactory();

    // 確実に絶対パスに変換

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

    let filename = "";

    res.forEach(r => {
      // ファイルパスの相対表示
      const relativeFilePath = path.relative(targetPath, r.filePath || "");

      if (r.filePath && r.filePath !== filename) {
        console.log("\n" + relativeFilePath + ":");
        filename = r.filePath;
        if (!options.compress) console.log("|...");
      }

      // ドキュメント（JSDoc等）の表示（圧縮モードでは非表示）
      if (!options.compress && r.boundary.docs) {
        console.log(indentFormat(r.boundary.docs, r.boundary.parent?.length ?? 0));
      }

      const content = r.content.split("\n");
      const indentLevel = r.boundary?.parent?.length ?? 0;

      // エンティティの最初の1行（シグネチャ）を表示
      console.log("|" + eachIndent.repeat(indentLevel) + content[0]);

      // 圧縮モードでない場合のみ、中身があることを示す "..." を表示
      if (!options.compress && content.length > 1) {
        console.log("|" + eachIndent.repeat(indentLevel) + "...");
      }
    });
  });

program.parse();
