import { describe, expect, it } from "vitest";
import { parseAIResponse } from "../src/ai-service";

describe("parseAIResponse", () => {
  it("parses thinking and options with separators", () => {
    const input = `分析原文本特点...

---

【方案1】通用得体版
您好，我是新来的同事小张，请问我应该坐哪个位置呀？

===

【方案2】轻松活泼版
哈喽～我是今天刚入职的小张，请问我的工位安排在哪里呀？`;

    const result = parseAIResponse(input);

    expect(result.thinking).toContain("分析原文本特点");
    expect(result.options).toHaveLength(2);
    expect(result.options[0].label).toBe("方案1 通用得体版");
    expect(result.options[0].text).toContain("您好，我是新来的同事小张");
    expect(result.options[1].label).toBe("方案2 轻松活泼版");
    expect(result.options[1].text).toContain("哈喽～我是今天刚入职的小张");
  });

  it("parses 5 options correctly", () => {
    const input = `思考过程...

---

【方案1】风格A
内容A

===

【方案2】风格B
内容B

===

【方案3】风格C
内容C

===

【方案4】风格D
内容D

===

【方案5】风格E
内容E`;

    const result = parseAIResponse(input);

    expect(result.options).toHaveLength(5);
    expect(result.options[4].label).toBe("方案5 风格E");
  });

  it("returns full text as default option when no separators", () => {
    const input = "这是一段没有分隔符的文本";

    const result = parseAIResponse(input);

    expect(result.thinking).toBe("");
    expect(result.options).toHaveLength(1);
    expect(result.options[0].text).toBe("这是一段没有分隔符的文本");
  });

  it("handles JSON format response", () => {
    const input = `{
  "thinking": "分析过程",
  "options": [
    {"label": "方案1 风格A", "text": "内容A"},
    {"label": "方案2 风格B", "text": "内容B"}
  ]
}`;

    const result = parseAIResponse(input);

    expect(result.thinking).toBe("分析过程");
    expect(result.options).toHaveLength(2);
    expect(result.options[0].label).toBe("方案1 风格A");
  });

  it("handles markdown header format", () => {
    const input = `思考...

---

### 1. 【方案1】风格A
内容A

### 2. 【方案2】风格B
内容B`;

    const result = parseAIResponse(input);

    expect(result.options).toHaveLength(2);
    expect(result.options[0].label).toBe("方案1 风格A");
  });
});
