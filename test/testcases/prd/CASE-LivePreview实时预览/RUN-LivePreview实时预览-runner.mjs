#!/usr/bin/env node
// RUN-LivePreview实时预览-runner.mjs — 双通道统一运行器（tcAIrunner 生成）
// 用法:
//   node RUN-LivePreview实时预览-runner.mjs                 # 运行全部
//   node RUN-LivePreview实时预览-runner.mjs --case=FP-04-01-N01   # 单条
//   node RUN-LivePreview实时预览-runner.mjs --channel=vitest       # 仅 Vitest
import { readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..", "..", ".."); // test/testcases/prd/CASE-LivePreview实时预览 → 项目根
const FEATURE = "LivePreview实时预览";
const CHANGE_ID = "prd";

// 解析参数
const args = process.argv.slice(2);
const onlyCase = args.find((a) => a.startsWith("--case="))?.split("=")[1];
const onlyChannel = args.find((a) => a.startsWith("--channel="))?.split("=")[1];

// 扫描目录
const files = readdirSync(__dirname)
  .filter((f) => /^RUN-.+\.(test|spec)\.ts$/.test(f))
  .sort();

if (files.length === 0) {
  console.log("⚠️ 目录下没有 RUN-*.test.ts / RUN-*.spec.ts 文件，请先执行阶段3生成。");
  process.exit(0);
}

const caseFiles = files.filter((f) => f.endsWith(".test.ts"));
const specFiles = files.filter((f) => f.endsWith(".spec.ts"));
let selectedFiles = onlyCase
  ? files.filter((f) => f.includes(`-${onlyCase}-`) || f.includes(onlyCase))
  : files;
if (onlyChannel === "vitest") selectedFiles = selectedFiles.filter((f) => caseFiles.includes(f));
if (onlyChannel === "playwright") selectedFiles = selectedFiles.filter((f) => specFiles.includes(f));

const results = [];

function runVitest(file) {
  console.log(`\n▶ Vitest: ${file}`);
  const r = spawnSync("npx", ["vitest", "run", join(__dirname, file), "--reporter=json"], {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
    timeout: 120_000,
  });
  if (r.status !== 0 && !r.stdout) {
    console.log(`  ✗ 运行失败: ${r.stderr?.slice(0, 500) || r.error?.message}`);
    return { status: "error", stdout: "" };
  }
  return { status: "ok", stdout: r.stdout };
}

function parseVitestJson(stdout) {
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) return null;
  try {
    return JSON.parse(stdout.slice(jsonStart));
  } catch {
    return null;
  }
}

function extractCaseId(file) {
  const m = file.match(/RUN-(FP-\d{2}-\d{2}-\w{2}\d{2})\.test\.ts/);
  return m ? m[1] : file.replace(/^RUN-/, "").replace(/\.test\.ts$/, "");
}

for (const file of selectedFiles) {
  const caseId = extractCaseId(file);
  const channel = file.endsWith(".test.ts") ? "vitest" : "playwright";

  if (channel === "playwright") {
    console.log(`\n▶ Playwright: ${file}（需 dev server 运行中）`);
    const r = spawnSync("npx", ["playwright", "test", join(__dirname, file), "--reporter=json"], {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 180_000,
    });
    const parsed = parseVitestJson(r.stdout || "");
    const ok = parsed && parsed.success;
    results.push({
      case_id: caseId, test_file: file, channel, status: ok ? "passed" : "failed",
      total_tests: parsed?.numTotalTests ?? 0, passed_tests: parsed?.numPassedTests ?? 0,
      failed_tests: parsed?.numFailedTests ?? 0, duration_ms: parsed?.durationMs ?? 0,
    });
    console.log(`  ${ok ? "✅ 通过" : "❌ 失败"}`);
    continue;
  }

  const r = runVitest(file);
  const parsed = parseVitestJson(r.stdout);
  if (!parsed) {
    results.push({ case_id: caseId, test_file: file, channel, status: "error", total_tests: 0, passed_tests: 0, failed_tests: 0, duration_ms: 0 });
    console.log("  ✗ JSON 解析失败");
    continue;
  }
  const ok = parsed.numFailedTests === 0 && parsed.numTotalTests > 0;
  results.push({
    case_id: caseId, test_file: file, channel, status: ok ? "passed" : "failed",
    total_tests: parsed.numTotalTests, passed_tests: parsed.numPassedTests,
    failed_tests: parsed.numFailedTests, duration_ms: parsed.durationMs ?? 0,
  });
  console.log(`  ${ok ? "✅ 通过" : "❌ 失败"} (${parsed.numPassedTests}/${parsed.numTotalTests})`);
}

// 汇总
const passed = results.filter((x) => x.status === "passed").length;
const failed = results.filter((x) => x.status === "failed").length;
const errored = results.filter((x) => x.status === "error").length;
const output = {
  runner_version: "1.1",
  change_id: CHANGE_ID,
  feature_point: FEATURE,
  run_at: new Date().toISOString(),
  channels: {
    vitest: {
      total_cases: results.filter((x) => x.channel === "vitest").length,
      passed: results.filter((x) => x.channel === "vitest" && x.status === "passed").length,
      failed: results.filter((x) => x.channel === "vitest" && x.status !== "passed").length,
    },
    playwright: {
      total_cases: results.filter((x) => x.channel === "playwright").length,
      passed: results.filter((x) => x.channel === "playwright" && x.status === "passed").length,
      failed: results.filter((x) => x.channel === "playwright" && x.status !== "passed").length,
    },
  },
  total_cases: results.length,
  results,
  summary: {
    passed_cases: passed,
    failed_cases: failed,
    skipped_cases: errored,
    pass_rate: results.length ? `${Math.round((passed / results.length) * 100)}%` : "0%",
  },
};

const outPath = join(__dirname, "RUN-LivePreview实时预览-results.json");
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`\n📊 汇总: ${passed} 通过 / ${failed} 失败 / ${errored} 错误 / 共 ${results.length}`);
console.log(`结果已写入: ${outPath}`);
