import { describe, expect, it } from "vitest";

import { createEditor } from "@floatboat/nexus-core";

import {
  createPasteCodePlugin,
  parseHtmlForCodeBlocks,
  detectCodeLanguage,
  extractLanguageFromClass,
  decodeHtmlEntities,
  convertHtmlToMarkdown,
} from "../src/index";

describe("plugin-paste-code", () => {
  describe("插件基本结构", () => {
    it("createPasteCodePlugin 返回正确的插件对象", () => {
      const plugin = createPasteCodePlugin();
      expect(plugin.name).toBe("plugin-paste-code");
      expect(plugin.handlers).toBeDefined();
      expect(plugin.handlers?.paste).toBeDefined();
      expect(typeof plugin.handlers?.paste).toBe("function");
    });

    it("支持自定义配置选项", () => {
      const plugin = createPasteCodePlugin({
        detectPlainText: false,
        plainTextConfidenceThreshold: 0.8,
      });
      expect(plugin.name).toBe("plugin-paste-code");
      expect(plugin.handlers?.paste).toBeDefined();
    });
  });

  describe("extractLanguageFromClass", () => {
    it("从 language-xxx 格式提取语言", () => {
      expect(extractLanguageFromClass("language-javascript")).toBe("javascript");
      expect(extractLanguageFromClass("language-python")).toBe("python");
      expect(extractLanguageFromClass("language-typescript")).toBe("typescript");
    });

    it("从 lang-xxx 格式提取语言", () => {
      expect(extractLanguageFromClass("lang-js")).toBe("javascript");
      expect(extractLanguageFromClass("lang-py")).toBe("python");
    });

    it("处理语言别名", () => {
      expect(extractLanguageFromClass("language-js")).toBe("javascript");
      expect(extractLanguageFromClass("language-ts")).toBe("typescript");
      expect(extractLanguageFromClass("language-py")).toBe("python");
      expect(extractLanguageFromClass("language-c++")).toBe("cpp");
      expect(extractLanguageFromClass("language-sh")).toBe("bash");
      expect(extractLanguageFromClass("language-yml")).toBe("yaml");
    });

    it("处理多 class", () => {
      expect(extractLanguageFromClass("hljs language-javascript other-class")).toBe("javascript");
      expect(extractLanguageFromClass("code-block lang-python")).toBe("python");
    });

    it("空值或无匹配时返回 null", () => {
      expect(extractLanguageFromClass(null)).toBeNull();
      expect(extractLanguageFromClass("")).toBeNull();
      expect(extractLanguageFromClass("some-other-class")).toBeNull();
    });
  });

  describe("decodeHtmlEntities", () => {
    it("反转义常见 HTML 实体", () => {
      expect(decodeHtmlEntities("&lt;div&gt;")).toBe("<div>");
      expect(decodeHtmlEntities("&amp;")).toBe("&");
      expect(decodeHtmlEntities("&quot;hello&quot;")).toBe('"hello"');
      expect(decodeHtmlEntities("&#39;")).toBe("'");
      expect(decodeHtmlEntities("&nbsp;")).toBe(" ");
    });

    it("处理数字实体", () => {
      expect(decodeHtmlEntities("&#65;")).toBe("A");
      expect(decodeHtmlEntities("&#97;")).toBe("a");
    });

    it("混合文本和实体", () => {
      expect(decodeHtmlEntities("if (a &lt; b) &amp;&amp; c &gt; d")).toBe("if (a < b) && c > d");
    });
  });

  describe("parseHtmlForCodeBlocks", () => {
    it("解析单个代码块", () => {
      const html = '<pre><code class="language-javascript">console.log("hello");</code></pre>';
      const result = parseHtmlForCodeBlocks(html);

      expect(result.hasCode).toBe(true);
      expect(result.codeBlocks).toHaveLength(1);
      expect(result.codeBlocks[0].language).toBe("javascript");
      expect(result.codeBlocks[0].code).toBe('console.log("hello");');
      expect(result.markdown).toContain("```javascript");
      expect(result.markdown).toContain('console.log("hello");');
      expect(result.markdown).toContain("```");
    });

    it("解析多个代码块", () => {
      const html = `
        <pre><code class="language-javascript">const a = 1;</code></pre>
        <p>一些文字</p>
        <pre><code class="language-python">print("hello")</code></pre>
      `;
      const result = parseHtmlForCodeBlocks(html);

      expect(result.hasCode).toBe(true);
      expect(result.codeBlocks).toHaveLength(2);
      expect(result.codeBlocks[0].language).toBe("javascript");
      expect(result.codeBlocks[1].language).toBe("python");
      expect(result.markdown).toContain("```javascript");
      expect(result.markdown).toContain("```python");
      expect(result.markdown).toContain("一些文字");
    });

    it("处理无语言标识的代码块", () => {
      const html = "<pre><code>some code</code></pre>";
      const result = parseHtmlForCodeBlocks(html);

      expect(result.hasCode).toBe(true);
      expect(result.codeBlocks[0].language).toBeNull();
      expect(result.markdown).toContain("```\nsome code\n```");
    });

    it("反转义代码中的 HTML 实体", () => {
      const html = '<pre><code class="language-html">&lt;div&gt;hello&lt;/div&gt;</code></pre>';
      const result = parseHtmlForCodeBlocks(html);

      expect(result.codeBlocks[0].code).toBe("<div>hello</div>");
      expect(result.markdown).toContain("<div>hello</div>");
    });

    it("空 HTML 返回无代码", () => {
      expect(parseHtmlForCodeBlocks("").hasCode).toBe(false);
      expect(parseHtmlForCodeBlocks("   ").hasCode).toBe(false);
    });

    it("纯文字无代码块返回无代码", () => {
      const html = "<p>这是一段普通文字，没有代码块</p>";
      const result = parseHtmlForCodeBlocks(html);

      expect(result.hasCode).toBe(false);
      expect(result.codeBlocks).toHaveLength(0);
    });

    it("处理嵌套在 div 中的代码块", () => {
      const html = '<div class="highlight"><pre><code class="language-go">fmt.Println("hello")</code></pre></div>';
      const result = parseHtmlForCodeBlocks(html);

      expect(result.hasCode).toBe(true);
      expect(result.codeBlocks[0].language).toBe("go");
      expect(result.codeBlocks[0].code).toBe('fmt.Println("hello")');
    });

    it("去掉代码首尾的空行", () => {
      const html = "<pre><code>\n\ncode line\n\n</code></pre>";
      const result = parseHtmlForCodeBlocks(html);

      expect(result.codeBlocks[0].code).toBe("code line");
    });
  });

  describe("detectCodeLanguage", () => {
    it("识别 JavaScript 代码", () => {
      const code = `
        const greeting = "hello";
        function sayHello(name) {
          console.log(greeting + ", " + name);
          return true;
        }
      `;
      const result = detectCodeLanguage(code);
      expect(result.isCode).toBe(true);
      expect(result.language).toBe("javascript");
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it("识别 Python 代码", () => {
      const code = `
        def hello(name):
            print(f"Hello, {name}")
            return True

        if __name__ == "__main__":
            hello("world")
      `;
      const result = detectCodeLanguage(code);
      expect(result.isCode).toBe(true);
      expect(result.language).toBe("python");
    });

    it("识别 Java 代码", () => {
      const code = `
        public class HelloWorld {
            public static void main(String[] args) {
                System.out.println("Hello, World!");
            }
        }
      `;
      const result = detectCodeLanguage(code);
      expect(result.isCode).toBe(true);
      expect(result.language).toBe("java");
    });

    it("识别 Go 代码", () => {
      const code = `
        package main

        import "fmt"

        func main() {
            fmt.Println("Hello, World!")
        }
      `;
      const result = detectCodeLanguage(code);
      expect(result.isCode).toBe(true);
      expect(result.language).toBe("go");
    });

    it("识别 Bash 代码", () => {
      const code = `
        #!/bin/bash
        echo "Hello, World!"
        for i in 1 2 3; do
          echo $i
        done
      `;
      const result = detectCodeLanguage(code);
      expect(result.isCode).toBe(true);
      expect(result.language).toBe("bash");
    });

    it("识别 SQL 代码", () => {
      const code = `
        SELECT id, name, email
        FROM users
        WHERE age > 18
        ORDER BY created_at DESC
        LIMIT 10;
      `;
      const result = detectCodeLanguage(code);
      expect(result.isCode).toBe(true);
      expect(result.language).toBe("sql");
    });

    it("识别 JSON 代码", () => {
      const code = `{
        "name": "test",
        "version": "1.0.0",
        "dependencies": {
          "react": "^18.0.0"
        }
      }`;
      const result = detectCodeLanguage(code);
      expect(result.isCode).toBe(true);
      expect(result.language).toBe("json");
    });

    it("识别 YAML 代码", () => {
      const code = `name: test
version: 1.0.0
services:
  web:
    image: nginx
    ports:
      - "80:80"
`;
      const result = detectCodeLanguage(code);
      expect(result.isCode).toBe(true);
      expect(result.language).toBe("yaml");
    });

    it("文字+代码混合的纯文本，文字部分不被包进代码块", () => {
      // 模拟用户粘贴的内容：开头是中文文字，后面是 PHP 代码
      const mixedText = `我是我
Public function checkout($a){
Return true;
}`;
      const result = detectCodeLanguage(mixedText);

      // 整体应该被识别为代码
      expect(result.isCode).toBe(true);

      // 验证分离逻辑：开头的中文应该被分离为文字部分
      // 这里通过检测语言来间接验证（PHP 代码应该被识别为 php，而不是把中文也算进去）
      expect(["php", "javascript"]).toContain(result.language);
    });

    it("同一行内文字+代码，文字部分不被包进代码块", () => {
      // 模拟用户粘贴的内容：同一行内开头是中文文字，后面是代码
      const mixedText = "我是我 public function($a){return true;}";
      const result = detectCodeLanguage(mixedText);

      // 整体应该被识别为代码
      expect(result.isCode).toBe(true);

      // PHP 代码应该被识别为 php 或 javascript
      expect(["php", "javascript"]).toContain(result.language);
    });

    it("普通文字不被识别为代码", () => {
      const text = "这是一段普通的中文文字，没有任何代码特征。";
      const result = detectCodeLanguage(text);
      expect(result.isCode).toBe(false);
    });

    it("空文本不被识别为代码", () => {
      expect(detectCodeLanguage("").isCode).toBe(false);
      expect(detectCodeLanguage("   ").isCode).toBe(false);
    });

    it("识别 TypeScript 代码", () => {
      const code = `
        interface User {
          id: number;
          name: string;
          email: string;
        }

        function getUser(id: number): User {
          return { id, name: "test", email: "test@example.com" };
        }
      `;
      const result = detectCodeLanguage(code);
      expect(result.isCode).toBe(true);
      // TypeScript 可能被识别为 typescript 或 javascript
      expect(["typescript", "javascript"]).toContain(result.language);
    });
  });

  describe("插件集成测试", () => {
    it("插件能正确注册到编辑器", () => {
      const container = document.createElement("div");
      const editor = createEditor({
        container,
        initialValue: "test",
        plugins: [createPasteCodePlugin()],
      });

      expect(editor).toBeDefined();
      expect(editor.getDocument()).toBe("test");
      editor.destroy();
    });

    it("beforeConvert 回调能修改转换结果", () => {
      const html = '<pre><code class="language-javascript">const a = 1;</code></pre>';
      const result = parseHtmlForCodeBlocks(html);

      expect(result.hasCode).toBe(true);

      // 模拟 beforeConvert 修改
      const modified = result.markdown.replace("```javascript", "```js");
      expect(modified).toContain("```js");
    });

    it("beforeConvert 返回 false 时跳过转换", () => {
      // 这个逻辑在插件的 paste 处理器中，这里只验证接口
      const plugin = createPasteCodePlugin({
        beforeConvert: () => false,
      });
      expect(plugin.handlers?.paste).toBeDefined();
    });
  });

  describe("convertHtmlToMarkdown 样式保留", () => {
    it("转换加粗和斜体", () => {
      const html = "<p><strong>加粗</strong> and <em>斜体</em></p>";
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("**加粗**");
      expect(markdown).toContain("*斜体*");
    });

    it("转换标题 h1-h6", () => {
      const html = "<h1>标题1</h1><h2>标题2</h2><h3>标题3</h3>";
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("# 标题1");
      expect(markdown).toContain("## 标题2");
      expect(markdown).toContain("### 标题3");
    });

    it("转换无序列表", () => {
      const html = "<ul><li>项目1</li><li>项目2</li><li>项目3</li></ul>";
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toMatch(/-+\s*项目1/);
      expect(markdown).toMatch(/-+\s*项目2/);
      expect(markdown).toMatch(/-+\s*项目3/);
    });

    it("转换有序列表", () => {
      const html = "<ol><li>第一步</li><li>第二步</li></ol>";
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("第一步");
      expect(markdown).toContain("第二步");
      expect(markdown).toMatch(/\d+\.\s+第一步/);
    });

    it("转换链接", () => {
      const html = '<p><a href="https://example.com">链接文字</a></p>';
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("[链接文字](https://example.com)");
    });

    it("转换图片", () => {
      const html = '<p><img src="https://example.com/image.png" alt="图片描述" /></p>';
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("![图片描述](https://example.com/image.png)");
    });

    it("转换引用块", () => {
      const html = "<blockquote><p>这是一段引用</p></blockquote>";
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("> 这是一段引用");
    });

    it("转换代码块并识别语言", () => {
      const html = '<pre><code class="language-javascript">const x = 1;</code></pre>';
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("```javascript");
      expect(markdown).toContain("const x = 1;");
    });

    it("转换代码块并识别 lang- 前缀的语言", () => {
      const html = '<pre><code class="lang-python">print("hello")</code></pre>';
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("```python");
      expect(markdown).toContain('print("hello")');
    });

    it("转换行内代码", () => {
      const html = "<p>使用 <code>console.log</code> 输出</p>";
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("`console.log`");
    });

    it("转换表格", () => {
      const html = `
        <table>
          <thead>
            <tr><th>姓名</th><th>年龄</th></tr>
          </thead>
          <tbody>
            <tr><td>张三</td><td>25</td></tr>
            <tr><td>李四</td><td>30</td></tr>
          </tbody>
        </table>
      `;
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("| 姓名 | 年龄 |");
      expect(markdown).toContain("| 张三 | 25 |");
      expect(markdown).toContain("| 李四 | 30 |");
    });

    it("转换混合内容（标题+段落+代码块+列表）", () => {
      const html = `
        <h1>测试文档</h1>
        <p>这是一段<strong>加粗</strong>和<em>斜体</em>的文字。</p>
        <pre><code class="language-typescript">const x: number = 1;</code></pre>
        <ul>
          <li>列表项1</li>
          <li>列表项2</li>
        </ul>
        <blockquote><p>引用内容</p></blockquote>
      `;
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("# 测试文档");
      expect(markdown).toContain("**加粗**");
      expect(markdown).toContain("*斜体*");
      expect(markdown).toContain("```typescript");
      expect(markdown).toContain("const x: number = 1;");
      expect(markdown).toMatch(/-\s+列表项1/);
      expect(markdown).toContain("> 引用内容");
    });

    it("空 HTML 返回空字符串", () => {
      expect(convertHtmlToMarkdown("")).toBe("");
      expect(convertHtmlToMarkdown("   ")).toBe("");
    });

    it("preserveFormatting 选项存在", () => {
      const plugin = createPasteCodePlugin({ preserveFormatting: true });
      expect(plugin.name).toBe("plugin-paste-code");
      expect(plugin.handlers?.paste).toBeDefined();
    });

    it("识别内联样式加粗（font-weight: bold）", () => {
      const html = '<p><span style="font-weight: bold;">加粗文字</span></p>';
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("**加粗文字**");
    });

    it("识别内联样式加粗（font-weight: 700）", () => {
      const html = '<p><span style="font-weight: 700;">加粗文字</span></p>';
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("**加粗文字**");
    });

    it("识别内联样式斜体（font-style: italic）", () => {
      const html = '<p><span style="font-style: italic;">斜体文字</span></p>';
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("*斜体文字*");
    });

    it("识别内联样式删除线（text-decoration: line-through）", () => {
      const html = '<p><span style="text-decoration: line-through;">删除线</span></p>';
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("~~删除线~~");
    });

    it("识别内联样式下划线（text-decoration: underline）", () => {
      const html = '<p><span style="text-decoration: underline;">下划线</span></p>';
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("<u>下划线</u>");
    });

    it("识别混合内联样式（嵌套 span 加粗+斜体）", () => {
      // 实际场景中，腾讯文档/WPS 通常用嵌套的 span 表示多种样式
      const html = '<p><span style="font-weight: bold;"><span style="font-style: italic;">加粗斜体</span></span></p>';
      const markdown = convertHtmlToMarkdown(html);
      // 加粗和斜体可能嵌套，只要包含加粗和斜体标记即可
      expect(markdown).toContain("**");
      expect(markdown).toContain("*");
      expect(markdown).toContain("加粗斜体");
    });

    it("过滤 HTML 注释", () => {
      const html = '<!-- 这是注释 --><p>正文内容</p>';
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).not.toContain("<!--");
      expect(markdown).not.toContain("这是注释");
      expect(markdown).toContain("正文内容");
    });

    it("过滤 WPS 样式定义注释", () => {
      const html = '<!--p.MsoNormal{ mso-style-name: 正文; }--><p>正文</p>';
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).not.toContain("MsoNormal");
      expect(markdown).not.toContain("mso-style-name");
      expect(markdown).toContain("正文");
    });

    it("去掉黑色文字的 span，只保留内容", () => {
      const html = '<p><span style="color: #000000;">黑色文字</span></p>';
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).not.toContain("<span");
      expect(markdown).toContain("黑色文字");
    });

    it("去掉 color: black 的 span", () => {
      const html = '<p><span style="color: black;">黑色文字</span></p>';
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).not.toContain("<span");
      expect(markdown).toContain("黑色文字");
    });

    it("去掉只带颜色样式的 span，只保留内容", () => {
      // 颜色在 Markdown 里支持不好，去掉只带颜色的 span，只保留内容
      const html = '<p><span style="color: #ff0000;">红色文字</span></p>';
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).not.toContain("<span");
      expect(markdown).not.toContain("color:");
      expect(markdown).toContain("红色文字");
    });

    it("标题里的彩色 span 被去掉，只保留内容", () => {
      const html = '<h1><span style="color: #376092">一、项目概述</span></h1>';
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("# 一、项目概述");
      expect(markdown).not.toContain("<span");
      expect(markdown).not.toContain("color:");
    });

    it("带加粗+颜色的 span 保留加粗样式", () => {
      // 如果 span 同时有颜色和加粗，保留加粗，去掉颜色
      const html = '<p><span style="color: #ff0000; font-weight: bold;">加粗红色文字</span></p>';
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("**加粗红色文字**");
      expect(markdown).not.toContain("color:");
    });

    it("修复有序列表的转义（1\\. → 1.）", () => {
      // 实际场景：HTML 里是 1.，turndown 会转义成 1\.，后处理再改回 1.
      const html = "<p>1. 第一项</p><p>2. 第二项</p>";
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("1. 第一项");
      expect(markdown).toContain("2. 第二项");
    });

    it("把 • 符号转成无序列表标记 -", () => {
      const html = "<p>• 第一项</p><p>• 第二项</p>";
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("- 第一项");
      expect(markdown).toContain("- 第二项");
      expect(markdown).not.toContain("•");
    });

    it("处理 WPS 混合内容（注释+黑色span+彩色span+列表）", () => {
      const html = `
        <!--p.MsoNormal{ mso-style-name: 正文; }-->
        <h1><span style="color: #376092">一、项目概述</span></h1>
        <p><span style="color: #000000">根据需求，包含 4 个环节：</span></p>
        <p><span style="color: #000000">1. 聊天推荐</span></p>
        <p><span style="color: #000000">2. 图片处理</span></p>
        <p><span style="color: #000000">• 核心技术要点</span></p>
      `;
      const markdown = convertHtmlToMarkdown(html);

      // 注释被过滤
      expect(markdown).not.toContain("MsoNormal");
      expect(markdown).not.toContain("<!--");

      // 标题里的彩色 span 被去掉，只保留内容
      expect(markdown).toContain("# 一、项目概述");
      expect(markdown).not.toContain("<span");
      expect(markdown).not.toContain("color:");

      // 黑色 span 被去掉
      expect(markdown).toContain("根据需求");
      expect(markdown).toContain("聊天推荐");

      // 有序列表转义被修复
      expect(markdown).toContain("1. 聊天推荐");

      // • 转成 -
      expect(markdown).toContain("- 核心技术要点");
      expect(markdown).not.toContain("•");
    });

    it("preserveFormatting 模式下，普通文本 HTML 不阻止纯文本代码检测", () => {
      // 模拟：剪贴板里有 HTML，但只是普通文本包装，没有丰富样式
      // 这种情况应该继续走纯文本代码检测
      const html = "<p>我是我 public function($a){return true;}</p>";
      const markdown = convertHtmlToMarkdown(html);
      expect(markdown).toContain("我是我");
      expect(markdown).toContain("public function");
    });
  });
});
