export function autoFixMarkdown(markdown: string): string {
  return autoCloseTrailingLink(markdown);
}

function autoCloseTrailingLink(markdown: string): string {
  // Fix unclosed Markdown links or images
  let fixedMarkdown: string = markdown;

  // Fix unclosed image syntax ![...](...)
  fixedMarkdown = fixedMarkdown.replace(
    /!\[([^\]]*)\]\(([^)]*)$/g,
    (match: string, altText: string, url: string): string => {
      return `![${altText}](${url})`;
    },
  );

  // Fix unclosed link syntax [...](...)
  fixedMarkdown = fixedMarkdown.replace(
    /\[([^\]]*)\]\(([^)]*)$/g,
    (match: string, linkText: string, url: string): string => {
      return `[${linkText}](${url})`;
    },
  );

  // Fix unclosed image syntax ![...]
  fixedMarkdown = fixedMarkdown.replace(
    /!\[([^\]]*)$/g,
    (match: string, altText: string): string => {
      return `![${altText}]`;
    },
  );

  // Fix unclosed link syntax [...]
  fixedMarkdown = fixedMarkdown.replace(
    /\[([^\]]*)$/g,
    (match: string, linkText: string): string => {
      return `[${linkText}]`;
    },
  );

  // Fix unclosed images or links missing ")"
  fixedMarkdown = fixedMarkdown.replace(
    /!\[([^\]]*)\]\(([^)]*)$/g,
    (match: string, altText: string, url: string): string => {
      return `![${altText}](${url})`;
    },
  );

  fixedMarkdown = fixedMarkdown.replace(
    /\[([^\]]*)\]\(([^)]*)$/g,
    (match: string, linkText: string, url: string): string => {
      return `[${linkText}](${url})`;
    },
  );

  return fixedMarkdown;
}
// 内容处理函数
export function processContent(content: any): string {
  // 如果包含"关键引用"或"关键文献引用"，则截断其后内容
  content = content.replace(/## \*\*?(关键引用|关键文献引用|Key Citations|参考文献)\*\*[\s\S]*/, '').trim()
  if(content.includes('## 关键引用')||content.includes('## 关键文献引用') || content.includes('## Key Citations') || content.includes('## 参考文献')) {
    const regex = /## (?:\*\*)?(关键引用|关键文献引用|Key Citations|参考文献)(?:\*\*)?/i;
      if (regex.test(content)) {
        content = content.split(regex)[0];
      }
  }
  return content
}
/**
 * 将 linkData 转换为 markdown 格式的字符串
 * @param linkData 链接数据数组
 * @returns markdown 格式的字符串
 */
export function generateMarkdownFromLinkData(linkData: any[]): string {
  if (!linkData || linkData.length === 0) {
    return '';
  }

  let markdown = '\n\n## 关键引用\n\n';

  linkData.forEach((item: any) => {
    if (item.title && item.url) {
      // 构建完整的 URL，包含授权信息
      const fullUrl = `${item.url}&authTokenOnly=${item.authorization || ''}`;
      markdown += `- [${item.title}](${fullUrl})\n\n`;
    }
  });

  return markdown.trim();
}