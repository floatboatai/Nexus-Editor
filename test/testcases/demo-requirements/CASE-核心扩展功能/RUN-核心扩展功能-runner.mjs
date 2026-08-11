#!/usr/bin/env node
/**
 * RUN-核心扩展功能-runner.mjs — 双通道统一运行器
 *
 * 职责:
 *   1. 扫描本目录 RUN-*.spec.ts（Playwright）和 RUN-*.test.ts（Vitest）
 *   2. 串行调度逐文件运行
 *   3. 解析 JSON 输出，生成 RUN-核心扩展功能-results.json
 *
 * 用法:
 *   node RUN-核心扩展功能-runner.mjs                       # 全部
 *   node RUN-核心扩展功能-runner.mjs --case=FP-11-01-N01   # 单条
 *   node RUN-核心扩展功能-runner.mjs --channel=playwright  # 仅 Playwright
 *   node RUN-核心扩展功能-runner.mjs --channel=vitest      # 仅 Vitest
 */
import { execSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_FILE = path.join(__dirname, "RUN-核心扩展功能-results.json");
const FEATURE = "核心扩展功能";
const CHANGE_ID = "demo-requirements";

// ---- 解析 CLI 参数 ----
const args = process.argv.slice(2);
const argCase = args.find((a) => a.startsWith("--case="))?.split("=")[1];
const argChannel = args.find((a) => a.startsWith("--channel="))?.split("=")[1];

// ---- 扫描文件（双通道：RUN-*.spec.ts → Playwright；RUN-*.test.ts → Vitest）----
const files = readdirSync(__dirname)
  .filter((f) => /^RUN-.+\.(spec|test)\.ts$/.test(f))
  .sort();

if (files.length === 0) {
  console.log("⚠️ 目录下没有 RUN-*.spec.ts / RUN-*.test.ts 文件。");
  process.exit(0);
}

const caseFiles = files.filter((f) => f.endsWith(".test.ts"));
const specFiles = files.filter((f) => f.endsWith(".spec.ts"));

// 单条用例过滤：用例 ID 形如 FP-11-02-N01，先去用例级后缀（N01/E01/B01）得到
// 文件名级前缀 FP-11-02 再匹配 RUN-*.ts 文件名（含完整 argCase 的精确子串优先）；
// 两者都未命中 → 打印警告并退出，杜绝"空匹配静默跑全部文件"（Q3）。
let selectedFiles = files;
if (argCase) {
  const casePrefix = /-[A-Za-z]\d+$/.test(argCase) ? argCase.replace(/-[A-Za-z]\d+$/, "") : argCase;
  const matched = files.filter((f) => f.includes(argCase) || f.includes(casePrefix));
  if (matched.length > 0) {
    selectedFiles = matched;
  } else {
    console.log(`⚠️ 没有匹配的用例文件（--case=${argCase} 与任何文件名都不匹配）。`);
    process.exit(0);
  }
}

// 通道过滤。注意：必须整体重新赋值，不能写 selectedFiles.length = filter(...).length，
// 那会把数组截断成长度数字（prd 系 runner 遗留 bug），后续 for-of 遍历会失效。
if (argChannel === "vitest") selectedFiles = selectedFiles.filter((f) => caseFiles.includes(f));
if (argChannel === "playwright") selectedFiles = selectedFiles.filter((f) => specFiles.includes(f));

if (selectedFiles.length === 0) {
  console.log("没有匹配的用例文件。");
  process.exit(0);
}

// ---- 运行 ----
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", ".."); // CASE-核心扩展功能 → 项目根
const results = [];

/** 提取 stdout 中的 JSON：vitest json reporter 输出可能带 npm warn / setup 日志前缀，取首个 "{" 起 */
function parseJsonOutput(stdout) {
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) return null;
  try {
    return JSON.parse(stdout.slice(jsonStart));
  } catch {
    return null;
  }
}

/**
 * 从 JSON 报告提取统计字段（正常分支与失败分支共用，I1）。
 * playwright：stats.expected/skipped/unexpected/duration；
 * vitest：顶层 numTotalTests/numPassedTests/numFailedTests，
 *   duration_ms 按 testResults[] 的 endTime - startTime 求和
 *   （vitest 2.1.9 JSON reporter 的 testResults[] 元素无 duration 字段，I2），
 *   skipped_tests 取 numPendingTests（顶层无 numSkippedTests，skip 计入该值，I3）。
 */
function buildStats(channel, json) {
  if (channel === "playwright") {
    const stats = json.stats ?? {};
    return {
      total_tests: (stats.expected ?? 0) + (stats.skipped ?? 0),
      passed_tests: stats.expected ?? 0,
      skipped_tests: stats.skipped ?? 0,
      failed_tests: stats.unexpected ?? 0,
      duration_ms: stats.duration ?? 0,
    };
  }
  return {
    total_tests: json.numTotalTests ?? 0,
    passed_tests: json.numPassedTests ?? 0,
    skipped_tests: json.numPendingTests ?? 0,
    failed_tests: json.numFailedTests ?? 0,
    duration_ms: json.testResults?.reduce((s, r) => s + (r.endTime - r.startTime), 0) ?? 0,
  };
}

/** vitest 断言级失败数（status 判定用） */
function vitestFailureCount(json) {
  return json.testResults?.flatMap((r) => r.assertionResults ?? []).filter((t) => t.status === "failed").length ?? 0;
}

for (const file of selectedFiles) {
  const absPath = path.join(__dirname, file);
  const caseId = file.replace(/^RUN-/, "").replace(/\.(spec|test)\.ts$/, "");
  const channel = file.endsWith(".spec.ts") ? "playwright" : "vitest";

  // Playwright 用本目录 CASE 级 config（testDir: ./），不带单文件路径，
  // 由 config 的 testMatch 一次性跑完本目录 RUN-*.spec.ts（本 CASE 24 用例 + 7 skip）；
  // Vitest 用项目根 config（vitest.config.ts 提供 @codemirror/* 等 alias）。
  const cwd = channel === "playwright" ? __dirname : PROJECT_ROOT;
  let cmd;
  if (channel === "playwright") {
    cmd = `npx playwright test --config=playwright.config.ts --reporter=json${argCase ? ` --grep=${JSON.stringify(argCase)}` : ""} 2>&1`;
  } else {
    // --case 指定时补 --testNamePattern 按用例 ID 过滤，避免 vitest 整文件全量跑（Q3）
    cmd = `npx vitest run ${JSON.stringify(absPath)} --reporter=json${argCase ? ` --testNamePattern=${JSON.stringify(argCase)}` : ""} 2>&1`;
  }

  console.log(`\n▶ 运行 ${caseId} [${channel}]`);
  try {
    // Electron 启动慢 + 24 用例 e2e 串行执行，execSync timeout 给足 10 分钟
    const stdout = execSync(cmd, { cwd, encoding: "utf8", timeout: 600_000 });
    const json = parseJsonOutput(stdout);

    if (json) {
      const stats = buildStats(channel, json);
      const status =
        channel === "playwright"
          ? (json.stats?.unexpected ?? 0) === 0 && (json.stats?.expected ?? 0) > 0
            ? "passed"
            : "failed"
          : vitestFailureCount(json) > 0
            ? "failed"
            : "passed";
      results.push({ case_id: caseId, test_file: file, channel, status, ...stats });
    } else {
      results.push({ case_id: caseId, test_file: file, channel, status: "unknown", error: "JSON 解析失败" });
    }
    console.log(`  → ${results[results.length - 1].status}`);
  } catch (err) {
    // execSync 非 0 退出时 throw（vitest/playwright 断言失败正是退出码非 0 的常见场景）：
    // 失败时 stdout 仍含完整 JSON 报告（reporter 在退出前已写），优先解析它并保留
    // 统计字段，仅 status 置 failed；JSON 解析失败才降级为 error 字符串（I1）。
    const errOutput = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    const json = parseJsonOutput(errOutput);
    if (json) {
      results.push({ case_id: caseId, test_file: file, channel, status: "failed", ...buildStats(channel, json) });
    } else {
      results.push({ case_id: caseId, test_file: file, channel, status: "failed", error: String(err.message ?? err) });
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
  change_id: CHANGE_ID,
  feature_point: FEATURE,
  run_at: new Date().toISOString(),
  channels: {
    vitest: {
      total_cases: results.filter((r) => r.channel === "vitest").length,
      passed: results.filter((r) => r.channel === "vitest" && r.status === "passed").length,
      failed: results.filter((r) => r.channel === "vitest" && r.status === "failed").length,
    },
    playwright: {
      total_cases: results.filter((r) => r.channel === "playwright").length,
      passed: results.filter((r) => r.channel === "playwright" && r.status === "passed").length,
      failed: results.filter((r) => r.channel === "playwright" && r.status === "failed").length,
    },
  },
  total_cases: results.length,
  results,
  summary: {
    passed_cases: passed,
    failed_cases: failed,
    // 用例级 skipped 汇总（playwright 通道的 test.skip / vitest 通道的 it.skip）
    skipped_cases: results.reduce((s, r) => s + (r.skipped_tests ?? 0), 0),
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
