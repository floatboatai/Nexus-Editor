#!/usr/bin/env node
/**
 * RUN-撤销重做插件-runner.mjs — 双通道统一运行器
 *
 * 职责:
 *   1. 扫描本目录 RUN-*.spec.ts（Playwright）和 RUN-*.test.ts（Vitest）
 *   2. 串行调度逐文件运行
 *   3. 解析 JSON 输出，生成 RUN-撤销重做插件-results.json
 *
 * 用法:
 *   node RUN-撤销重做插件-runner.mjs                       # 全部
 *   node RUN-撤销重做插件-runner.mjs --case=FP-14-01-N01   # 单条
 *   node RUN-撤销重做插件-runner.mjs --channel=playwright  # 仅 Playwright
 *   node RUN-撤销重做插件-runner.mjs --channel=vitest      # 仅 Vitest
 */
import { execSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_FILE = path.join(__dirname, "RUN-撤销重做插件-results.json");

// ---- 解析 CLI 参数 ----
const args = process.argv.slice(2);
const argCase = args.find((a) => a.startsWith("--case="))?.split("=")[1];
const argChannel = args.find((a) => a.startsWith("--channel="))?.split("=")[1];

// ---- 扫描文件 ----
const files = readdirSync(__dirname).filter((f) =>
  (f.endsWith(".spec.ts") && argChannel !== "vitest") ||
  (f.endsWith(".test.ts") && argChannel !== "playwright"),
);

// 过滤单条用例
const selected = argCase ? files.filter((f) => f.includes(argCase)) : files;

if (selected.length === 0) {
  console.log("没有匹配的用例文件。");
  process.exit(0);
}

// ---- 运行 ----
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const results = [];
for (const file of selected) {
  const absPath = path.join(__dirname, file);
  const caseId = file.replace(/^RUN-/, "").replace(/\.(spec|test)\.ts$/, "");
  const channel = file.endsWith(".spec.ts") ? "playwright" : "vitest";

  let cmd;
  // Playwright 用 CASE 级 config（testDir: ./）；Vitest 用项目根
  const cwd = channel === "playwright" ? __dirname : PROJECT_ROOT;
  if (channel === "playwright") {
    cmd = `npx playwright test ${JSON.stringify(absPath)} --config=playwright.config.ts --reporter=json 2>&1`;
  } else {
    cmd = `npx vitest run ${JSON.stringify(absPath)} --reporter=json 2>&1`;
  }

  console.log(`\n▶ 运行 ${caseId} [${channel}]`);
  try {
    const stdout = execSync(cmd, { cwd, encoding: "utf8", timeout: 120_000 });
    // JSON reporter 输出单个 pretty-print JSON（npm warn 等前缀在 stderr 混入 stdout 开头）
    const jsonStart = stdout.indexOf("{");
    const json = jsonStart >= 0 ? JSON.parse(stdout.slice(jsonStart)) : null;

    if (channel === "playwright" && json) {
      const stats = json.stats ?? {};
      results.push({
        case_id: caseId,
        test_file: file,
        channel,
        status: (stats.unexpected ?? 0) === 0 ? "passed" : "failed",
        total_tests: stats.expected ?? 0,
        passed_tests: stats.expected ?? 0,
        failed_tests: stats.unexpected ?? 0,
        duration_ms: stats.duration ?? 0,
      });
    } else if (channel === "vitest" && json) {
      const failures = json.testResults?.flatMap((r) => r.assertionResults ?? []).filter((t) => t.status === "failed") ?? [];
      results.push({
        case_id: caseId,
        test_file: file,
        channel,
        status: failures.length > 0 ? "failed" : "passed",
        total_tests: json.numTotalTests ?? 0,
        passed_tests: json.numPassedTests ?? 0,
        failed_tests: json.numFailedTests ?? 0,
        duration_ms: json.numTotalTests ? 0 : 0,
      });
    } else {
      results.push({ case_id: caseId, test_file: file, channel, status: "unknown", error: "JSON 解析失败" });
    }
    console.log(`  → ${results[results.length - 1].status}`);
  } catch (err) {
    // execSync 非 0 退出时 throw（vitest/playwright 断言失败正是退出码非 0 的常见场景）：
    // 失败时 stdout 仍含完整 JSON 报告（reporter 在退出前已写），优先解析它并保留
    // 统计字段，仅 status 置 failed（对齐 RUN-核心扩展功能-runner.mjs 的 catch 处理）；
    // JSON 解析失败则降级为 error 字符串，并打印 stdout 末尾片段，避免 CI 中失败详情被丢弃。
    const errOutput = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    let errJson = null;
    const jsonStart = errOutput.indexOf("{");
    if (jsonStart >= 0) {
      try {
        errJson = JSON.parse(errOutput.slice(jsonStart));
      } catch {
        errJson = null;
      }
    }
    if (channel === "playwright" && errJson) {
      const stats = errJson.stats ?? {};
      results.push({
        case_id: caseId,
        test_file: file,
        channel,
        status: "failed",
        total_tests: stats.expected ?? 0,
        passed_tests: stats.expected ?? 0,
        failed_tests: stats.unexpected ?? 0,
        duration_ms: stats.duration ?? 0,
      });
    } else if (channel === "vitest" && errJson) {
      results.push({
        case_id: caseId,
        test_file: file,
        channel,
        status: "failed",
        total_tests: errJson.numTotalTests ?? 0,
        passed_tests: errJson.numPassedTests ?? 0,
        failed_tests: errJson.numFailedTests ?? 0,
        duration_ms: 0,
      });
    } else {
      results.push({ case_id: caseId, test_file: file, channel, status: "failed", error: String(err.message ?? err) });
      const tail = errOutput.trim().split("\n").slice(-20).join("\n");
      if (tail) console.log(`  原始输出末尾:\n${tail}`);
    }
    console.log(`  → failed (${String(err.message ?? err).slice(0, 120)})`);
  }
}

// ---- 汇总 ----
const passed = results.filter((r) => r.status === "passed").length;
const failed = results.filter((r) => r.status === "failed").length;
const unknown = results.filter((r) => r.status === "unknown").length;

const report = {
  runner_version: "1.1",
  feature_point: "撤销重做插件",
  run_at: new Date().toISOString(),
  channels: {
    vitest: { total_cases: results.filter((r) => r.channel === "vitest").length, passed: results.filter((r) => r.channel === "vitest" && r.status === "passed").length, failed: results.filter((r) => r.channel === "vitest" && r.status === "failed").length },
    playwright: { total_cases: results.filter((r) => r.channel === "playwright").length, passed: results.filter((r) => r.channel === "playwright" && r.status === "passed").length, failed: results.filter((r) => r.channel === "playwright" && r.status === "failed").length },
  },
  total_cases: results.length,
  results,
  summary: {
    passed_cases: passed,
    failed_cases: failed,
    skipped_cases: unknown,
    pass_rate: results.length ? `${Math.round((passed / results.length) * 100)}%` : "0%",
  },
};

writeFileSync(RESULTS_FILE, JSON.stringify(report, null, 2), "utf8");
console.log(`\n========== 汇总 ==========`);
console.log(`通过: ${passed} / 失败: ${failed} / 未知: ${unknown} / 总计: ${results.length}`);
console.log(`结果已写入: ${RESULTS_FILE}`);

// CI 退出码：任一用例失败或状态未知（如 JSON 解析失败）→ 非 0，让 CI 步骤真实反映结果。
// 用 process.exitCode 而非 process.exit()，确保上方 results.json 写入已完成。
// 注意：--case 无匹配时的提前 process.exit(0) 是有意保留的行为，不受本行影响。
process.exitCode = failed > 0 || unknown > 0 ? 1 : 0;
