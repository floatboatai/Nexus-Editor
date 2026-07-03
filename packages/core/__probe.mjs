import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import {unified} from 'unified';
const src = '| a | b |\n| --- | --- |\n| 1 | 2 | 3 |\n1 | 2';
const tree = unified().use(remarkParse).use(remarkGfm).parse(src);
const table = tree.children[0];
console.log(JSON.stringify(table.children.map(r => r.children.map(c => c.children[0]?.value ?? ''))));
