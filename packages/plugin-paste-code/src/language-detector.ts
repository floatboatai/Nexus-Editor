/**
 * 纯文本代码检测与语言识别。
 *
 * 用于处理从终端、纯文本编辑器复制的代码（没有 HTML 格式）。
 * 通过关键字和特征匹配来判断是否是代码，以及是什么语言。
 */

export interface TextDetectionResult {
  /** 是否是代码 */
  isCode: boolean;
  /** 识别到的语言，未识别时为 null */
  language: string | null;
  /** 置信度 0-1 */
  confidence: number;
}

/**
 * 语言特征定义：关键字、符号、注释风格等。
 */
interface LanguageFeatures {
  name: string;
  /** 关键字（出现次数越多，置信度越高） */
  keywords: string[];
  /** 常见的类型/内置对象 */
  types?: string[];
  /** 注释前缀 */
  commentPrefix?: string;
  /** 必须出现的特征（任一即可） */
  required?: RegExp[];
}

const LANGUAGE_FEATURES: LanguageFeatures[] = [
  {
    name: "javascript",
    keywords: ["const", "let", "var", "function", "=>", "async", "await", "import", "export", "from", "class", "extends", "new", "this", "return", "if", "else", "for", "while", "switch", "case", "break", "continue", "try", "catch", "finally", "throw", "typeof", "instanceof"],
    types: ["console", "window", "document", "Promise", "Array", "Object", "String", "Number", "Boolean", "Math", "JSON", "Date", "Error", "Map", "Set", "Symbol"],
    commentPrefix: "//",
  },
  {
    name: "typescript",
    keywords: ["interface", "type", "enum", "implements", "public", "private", "protected", "readonly", "abstract", "static", "as", "namespace", "declare", "generics"],
    types: ["string", "number", "boolean", "void", "any", "unknown", "never", "null", "undefined"],
    commentPrefix: "//",
  },
  {
    name: "python",
    keywords: ["def", "class", "import", "from", "as", "if", "elif", "else", "for", "while", "break", "continue", "return", "yield", "try", "except", "finally", "raise", "with", "lambda", "pass", "None", "True", "False", "self", "print", "in", "not", "and", "or", "is", "global", "nonlocal"],
    types: ["int", "str", "float", "bool", "list", "dict", "tuple", "set", "bytes"],
    commentPrefix: "#",
  },
  {
    name: "java",
    keywords: ["public", "private", "protected", "class", "interface", "extends", "implements", "static", "final", "void", "new", "this", "super", "return", "if", "else", "for", "while", "switch", "case", "break", "continue", "try", "catch", "finally", "throw", "throws", "import", "package", "abstract", "synchronized", "volatile", "transient", "instanceof"],
    types: ["String", "int", "long", "double", "float", "boolean", "char", "byte", "short", "Integer", "Long", "Double", "Float", "Boolean", "List", "Map", "Set", "ArrayList", "HashMap", "System", "Object"],
    commentPrefix: "//",
  },
  {
    name: "go",
    keywords: ["func", "package", "import", "var", "const", "type", "struct", "interface", "map", "chan", "go", "defer", "select", "case", "switch", "if", "else", "for", "range", "return", "break", "continue", "fallthrough", "nil", "true", "false"],
    types: ["string", "int", "int64", "int32", "float64", "float32", "bool", "byte", "rune", "error", "interface"],
    commentPrefix: "//",
  },
  {
    name: "rust",
    keywords: ["fn", "let", "mut", "const", "static", "struct", "enum", "trait", "impl", "pub", "mod", "use", "crate", "self", "super", "where", "for", "in", "loop", "while", "if", "else", "match", "return", "break", "continue", "move", "ref", "dyn", "async", "await", "unsafe", "extern", "type", "Self"],
    types: ["String", "str", "i32", "i64", "u32", "u64", "f32", "f64", "bool", "char", "Vec", "Option", "Result", "Box", "Rc", "Arc", "HashMap", "HashSet"],
    commentPrefix: "//",
  },
  {
    name: "cpp",
    keywords: ["class", "struct", "public", "private", "protected", "virtual", "override", "final", "template", "typename", "namespace", "using", "new", "delete", "this", "nullptr", "return", "if", "else", "for", "while", "switch", "case", "break", "continue", "try", "catch", "throw", "const", "static", "inline", "explicit", "friend", "operator", "constexpr", "auto", "decltype"],
    types: ["int", "long", "short", "char", "float", "double", "bool", "void", "string", "vector", "map", "set", "unordered_map", "unordered_set", "std", "cout", "cin", "endl"],
    commentPrefix: "//",
  },
  {
    name: "c",
    keywords: ["#include", "#define", "#ifdef", "#ifndef", "#endif", "typedef", "struct", "enum", "union", "static", "const", "extern", "volatile", "register", "auto", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "goto", "sizeof", "malloc", "free", "printf", "scanf", "NULL"],
    types: ["int", "long", "short", "char", "float", "double", "void", "unsigned", "signed", "size_t", "FILE"],
    commentPrefix: "//",
  },
  {
    name: "bash",
    keywords: ["#!/bin/bash", "#!/bin/sh", "echo", "cd", "ls", "pwd", "export", "source", "if", "then", "else", "elif", "fi", "for", "do", "done", "while", "until", "case", "esac", "function", "return", "exit", "read", "local", "declare", "readonly", "unset", "shift", "set", "trap", "eval", "exec"],
    types: ["$1", "$2", "$@", "$#", "$?", "$$", "$!", "$0"],
    commentPrefix: "#",
  },
  {
    name: "ruby",
    keywords: ["def", "end", "class", "module", "require", "include", "extend", "attr_accessor", "attr_reader", "attr_writer", "if", "else", "elsif", "unless", "while", "until", "for", "do", "begin", "rescue", "ensure", "raise", "throw", "catch", "return", "yield", "lambda", "proc", "self", "nil", "true", "false", "puts", "print", "gets"],
    types: ["String", "Integer", "Float", "Array", "Hash", "Symbol", "TrueClass", "FalseClass", "NilClass", "Object"],
    commentPrefix: "#",
  },
  {
    name: "php",
    keywords: ["<?php", "function", "class", "interface", "trait", "extends", "implements", "public", "private", "protected", "static", "const", "var", "echo", "print", "return", "if", "else", "elseif", "for", "foreach", "while", "do", "switch", "case", "break", "continue", "try", "catch", "finally", "throw", "new", "this", "self", "parent", "use", "namespace", "abstract", "final"],
    types: ["string", "int", "float", "bool", "array", "object", "null", "void", "mixed", "iterable"],
    commentPrefix: "//",
  },
  {
    name: "swift",
    keywords: ["func", "var", "let", "class", "struct", "enum", "protocol", "extension", "import", "guard", "if", "else", "for", "in", "while", "repeat", "switch", "case", "break", "continue", "fallthrough", "return", "throw", "throws", "rethrows", "try", "catch", "defer", "where", "associatedtype", "typealias", "subscript", "willSet", "didSet", "lazy", "weak", "unowned", "self", "Self", "nil", "true", "false"],
    types: ["String", "Int", "Double", "Float", "Bool", "Character", "Array", "Dictionary", "Set", "Optional", "Result", "Error"],
    commentPrefix: "//",
  },
  {
    name: "kotlin",
    keywords: ["fun", "val", "var", "class", "object", "interface", "companion", "data", "sealed", "enum", "abstract", "open", "final", "override", "private", "protected", "internal", "public", "import", "package", "typealias", "constructor", "init", "this", "super", "return", "if", "else", "for", "in", "while", "do", "when", "is", "as", "try", "catch", "finally", "throw", "suspend", "inline", "crossinline", "noinline", "reified", "tailrec", "operator", "infix", "const", "lateinit", "by", "get", "set", "null", "true", "false", "it"],
    types: ["String", "Int", "Long", "Double", "Float", "Boolean", "Char", "Byte", "Short", "Array", "List", "Map", "Set", "Any", "Unit", "Nothing"],
    commentPrefix: "//",
  },
  {
    name: "sql",
    keywords: ["SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "ALTER", "DROP", "INDEX", "VIEW", "TRIGGER", "PROCEDURE", "FUNCTION", "DATABASE", "SCHEMA", "JOIN", "INNER", "LEFT", "RIGHT", "OUTER", "FULL", "CROSS", "ON", "USING", "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "OFFSET", "UNION", "ALL", "DISTINCT", "AS", "AND", "OR", "NOT", "NULL", "IS", "IN", "BETWEEN", "LIKE", "EXISTS", "CASE", "WHEN", "THEN", "ELSE", "END", "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "UNIQUE", "CHECK", "DEFAULT", "AUTO_INCREMENT", "COMMIT", "ROLLBACK", "BEGIN", "TRANSACTION"],
    commentPrefix: "--",
  },
  {
    name: "yaml",
    keywords: [],
    commentPrefix: "#",
    // YAML 特征：key: value 格式，但不能有分号（代码特征）
    required: [/^\s*[\w-]+:\s*[^;{}\n]*$/m],
  },
  {
    name: "json",
    keywords: [],
    commentPrefix: "",
    required: [/^\s*[\{|\[]/m, /"[^"]+"\s*:/m],
  },
  {
    name: "html",
    keywords: [],
    commentPrefix: "<!--",
    required: [/<\/?[a-z][\s\S]*>/i],
  },
  {
    name: "css",
    keywords: [],
    commentPrefix: "/*",
    required: [/[.#]?[\w-]+\s*\{[\s\S]*?\}/m],
  },
];

/**
 * 检测纯文本是否是代码，并识别语言。
 *
 * @param text 纯文本内容
 * @returns 检测结果
 */
export function detectCodeLanguage(text: string): TextDetectionResult {
  if (!text || !text.trim()) {
    return { isCode: false, language: null, confidence: 0 };
  }

  const lines = text.split("\n");
  const lineCount = lines.length;
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);

  // 太短的文本不认为是代码
  if (lineCount < 2 && nonEmptyLines.length < 1) {
    return { isCode: false, language: null, confidence: 0 };
  }

  // 单行文本不认为是代码（除非有明显的代码特征）
  if (lineCount === 1) {
    const hasCodeFeature = /[{};()=]/.test(text) && /\b(function|const|let|var|def|class|func|import)\b/.test(text);
    if (!hasCodeFeature) {
      return { isCode: false, language: null, confidence: 0 };
    }
  }

  // 计算代码特征分数
  let codeScore = 0;

  // 有大括号
  if (/[{}]/.test(text)) codeScore += 2;
  // 有分号
  if (/;/.test(text)) codeScore += 1;
  // 有括号配对
  if (/\(.*\)/.test(text)) codeScore += 1;
  // 有等号赋值
  if (/=/.test(text)) codeScore += 1;
  // 有箭头函数
  if (/=>/.test(text)) codeScore += 2;
  // 有注释
  if (/(\/\/|#|--|\/\*)/.test(text)) codeScore += 1;
  // 有常见关键字
  if (/\b(function|const|let|var|def|class|func|import|export|return|if|else|for|while)\b/.test(text)) codeScore += 3;
  // 多行且有缩进
  if (lineCount > 3 && /^\s+/.test(text)) codeScore += 1;

  // 识别各语言的分数
  const languageScores: { language: string; score: number }[] = [];

  for (const features of LANGUAGE_FEATURES) {
    let score = 0;

    // 检查必须特征
    if (features.required && features.required.length > 0) {
      const hasRequired = features.required.some((re) => re.test(text));
      if (!hasRequired) continue;
      score += 3; // 满足必须特征，基础分（配置语言用，避免误判）
    }

    // 关键字匹配
    for (const keyword of features.keywords) {
      const regex = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "gi");
      const matches = text.match(regex);
      if (matches) {
        score += matches.length;
      }
    }

    // 类型匹配
    if (features.types) {
      for (const type of features.types) {
        const regex = new RegExp(`\\b${escapeRegExp(type)}\\b`, "g");
        const matches = text.match(regex);
        if (matches) {
          score += matches.length * 0.5;
        }
      }
    }

    if (score > 0) {
      languageScores.push({ language: features.name, score });
    }
  }

  // 后处理：根据特有语法调整分数
  // TypeScript 特有语法：interface、type、enum、implements、readonly、abstract
  if (/\b(interface|enum|implements|readonly|abstract)\b/.test(text)) {
    const tsEntry = languageScores.find((l) => l.language === "typescript");
    if (tsEntry) {
      tsEntry.score += 5;
    } else {
      languageScores.push({ language: "typescript", score: 5 });
    }
  }

  // PHP 特征：$ 变量前缀（排除 bash 的短变量 $1、$@、$# 等）
  if (/\$[a-zA-Z_]\w{2,}/.test(text)) {
    const phpEntry = languageScores.find((l) => l.language === "php");
    if (phpEntry) {
      phpEntry.score += 5;
    }
  }

  // Bash 特有语法：shebang、do/done、fi、esac、then
  if (/(#!\/bin\/(bash|sh)|^\s*done\s*$|^\s*fi\s*$|^\s*esac\s*$|^\s*then\s*$)/m.test(text)) {
    const bashEntry = languageScores.find((l) => l.language === "bash");
    if (bashEntry) {
      bashEntry.score += 5;
    } else {
      languageScores.push({ language: "bash", score: 5 });
    }
  }

  // Python 特征：缩进 + def/class + 无分号
  if (/\b(def|class)\b/.test(text) && /^\s+/m.test(text) && !/;/.test(text)) {
    const pyEntry = languageScores.find((l) => l.language === "python");
    if (pyEntry) {
      pyEntry.score += 3;
    }
  }

  // Go 特征：package + func + import
  if (/\bpackage\b/.test(text) && /\bfunc\b/.test(text)) {
    const goEntry = languageScores.find((l) => l.language === "go");
    if (goEntry) {
      goEntry.score += 5;
    }
  }

  // 排序，取最高分
  languageScores.sort((a, b) => b.score - a.score);

  const topMatch = languageScores[0];
  const secondMatch = languageScores[1];

  // 计算置信度
  let confidence = 0;
  let detectedLanguage: string | null = null;

  if (topMatch && topMatch.score >= 2) {
    detectedLanguage = topMatch.language;
    // 置信度基于最高分和与第二名的差距
    const ratio = secondMatch ? topMatch.score / (secondMatch.score + 1) : topMatch.score;
    confidence = Math.min(0.95, 0.5 + ratio * 0.1 + Math.min(topMatch.score, 10) * 0.03);
  }

  // 综合判断是否是代码
  const isCode = codeScore >= 3 || (detectedLanguage !== null && confidence >= 0.5);

  if (!isCode) {
    return { isCode: false, language: null, confidence: 0 };
  }

  return {
    isCode: true,
    language: detectedLanguage,
    confidence: confidence || 0.4,
  };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
