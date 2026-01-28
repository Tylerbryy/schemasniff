import { chromium, type Page } from 'playwright';

export interface AnalyzerOptions {
  minItems: number;
  maxDepth: number;
  fieldTypes: string[];
  includeEmpty: boolean;
  enableJs: boolean;
  confidenceThreshold: number;
}

export interface Field {
  name: string;
  selector: string;
  type: string;
  confidence: number;
  sample?: string;
}

export interface Schema {
  url: string;
  timestamp: string;
  containerSelector: string;
  fields: Field[];
  itemCount: number;
  confidence: number;
}

interface DOMPattern {
  selector: string;
  count: number;
  depth: number;
  children: Map<string, any>;
  samples: any[];
}

export async function analyzeUrl(url: string, options: AnalyzerOptions): Promise<Schema> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { 
      waitUntil: options.enableJs ? 'networkidle' : 'domcontentloaded',
      timeout: 30000 
    });

    // Find repeated patterns in the DOM
    const patterns = await findRepeatedPatterns(page, options);
    
    // Select the most promising pattern
    const bestPattern = selectBestPattern(patterns, options);
    
    if (!bestPattern) {
      throw new Error('No repeated patterns found matching criteria');
    }

    // Infer field types for the pattern
    const fields = await inferFields(page, bestPattern, options);

    const schema: Schema = {
      url,
      timestamp: new Date().toISOString(),
      containerSelector: bestPattern.selector,
      fields,
      itemCount: bestPattern.count,
      confidence: bestPattern.count >= options.minItems ? 0.9 : 0.6
    };

    return schema;
  } finally {
    await browser.close();
  }
}

async function findRepeatedPatterns(page: Page, options: AnalyzerOptions): Promise<DOMPattern[]> {
  // Extract DOM structure and find repeated elements
  const patterns = await page.evaluate(({ minItems }) => {
    const results: any[] = [];
    const tagCounts = new Map<string, { selector: string; elements: Element[] }>();

    // Common container tags that often hold repeated content
    const containerTags = ['article', 'div', 'li', 'tr', 'section', 'card'];
    
    // Find elements with similar structure
    containerTags.forEach(tag => {
      const elements = Array.from(document.querySelectorAll(tag));
      
      // Group by class name patterns
      const classGroups = new Map<string, Element[]>();
      
      elements.forEach(el => {
        const className = el.className.toString().trim();
        if (!className) return;
        
        // Get primary class (first one or most specific)
        const primaryClass = className.split(/\s+/)[0];
        if (!primaryClass) return;
        
        const selector = `${tag}.${primaryClass}`;
        if (!classGroups.has(selector)) {
          classGroups.set(selector, []);
        }
        classGroups.get(selector)!.push(el);
      });

      // Keep groups with enough repetitions
      classGroups.forEach((els, selector) => {
        if (els.length >= minItems) {
          tagCounts.set(selector, { selector, elements: els });
        }
      });
    });

    // Convert to pattern objects
    tagCounts.forEach(({ selector, elements }) => {
      const samples = elements.slice(0, 3).map(el => ({
        html: el.outerHTML.substring(0, 200),
        text: el.textContent?.substring(0, 100),
        childCount: el.children.length
      }));

      results.push({
        selector,
        count: elements.length,
        depth: getDepth(elements[0]),
        samples
      });
    });

    function getDepth(el: Element): number {
      let depth = 0;
      let current: Element | null = el;
      while (current && current.parentElement) {
        depth++;
        current = current.parentElement;
      }
      return depth;
    }

    return results;
  }, { minItems: options.minItems });

  return patterns;
}

function selectBestPattern(patterns: DOMPattern[], options: AnalyzerOptions): DOMPattern | null {
  if (patterns.length === 0) return null;

  // Score patterns based on:
  // - Count (more is better)
  // - Depth (moderate depth is better - not too shallow, not too deep)
  // - Structure consistency
  const scored = patterns.map(p => {
    let score = 0;
    
    // Count score (logarithmic)
    score += Math.log(p.count) * 10;
    
    // Depth score (prefer depth 3-6)
    const idealDepth = 4;
    const depthScore = Math.max(0, 10 - Math.abs(p.depth - idealDepth) * 2);
    score += depthScore;
    
    return { pattern: p, score };
  });

  // Sort by score and return best
  scored.sort((a, b) => b.score - a.score);
  return scored[0].pattern;
}

async function inferFields(page: Page, pattern: DOMPattern, options: AnalyzerOptions): Promise<Field[]> {
  const fields = await page.evaluate(({ selector, includeEmpty, confidenceThreshold }) => {
    const containers = Array.from(document.querySelectorAll(selector));
    if (containers.length === 0) return [];

    const fieldMap = new Map<string, any>();

    // Analyze first few items to find common fields
    containers.slice(0, Math.min(5, containers.length)).forEach((container, idx) => {
      // Find all text nodes and common elements
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_ELEMENT,
        null
      );

      let node: Node | null;
      while ((node = walker.nextNode())) {
        const el = node as Element;
        const tagName = el.tagName.toLowerCase();
        
        // Skip script/style
        if (tagName === 'script' || tagName === 'style') continue;

        // Check for links
        if (tagName === 'a' && el.hasAttribute('href')) {
          const href = el.getAttribute('href') || '';
          const text = el.textContent?.trim() || '';
          if (text || includeEmpty) {
            const key = `link_${getElementPath(el, container)}`;
            if (!fieldMap.has(key)) {
              fieldMap.set(key, {
                name: text ? sanitizeName(text) : 'link',
                type: 'href',
                selector: getRelativeSelector(el, selector),
                samples: []
              });
            }
            fieldMap.get(key).samples.push(href);
          }
        }

        // Check for images
        if (tagName === 'img' && el.hasAttribute('src')) {
          const src = el.getAttribute('src') || '';
          const alt = el.getAttribute('alt') || 'image';
          const key = `img_${getElementPath(el, container)}`;
          if (!fieldMap.has(key)) {
            fieldMap.set(key, {
              name: sanitizeName(alt),
              type: 'url',
              selector: getRelativeSelector(el, selector),
              samples: []
            });
          }
          fieldMap.get(key).samples.push(src);
        }

        // Check for text content
        if (el.children.length === 0) {
          const text = el.textContent?.trim() || '';
          if (text || includeEmpty) {
            const type = inferType(text);
            const key = `${type}_${getElementPath(el, container)}`;
            if (!fieldMap.has(key)) {
              fieldMap.set(key, {
                name: sanitizeName(text) || tagName,
                type,
                selector: getRelativeSelector(el, selector),
                samples: []
              });
            }
            fieldMap.get(key).samples.push(text);
          }
        }
      }
    });

    // Convert to fields array
    const fields: any[] = [];
    fieldMap.forEach((data, key) => {
      // Calculate confidence based on sample consistency
      const uniqueSamples = new Set(data.samples).size;
      const confidence = uniqueSamples / data.samples.length;
      
      if (confidence >= confidenceThreshold) {
        fields.push({
          name: data.name,
          selector: data.selector,
          type: data.type,
          confidence: Math.round(confidence * 100) / 100,
          sample: data.samples[0]
        });
      }
    });

    function getElementPath(el: Element, root: Element): string {
      const path: string[] = [];
      let current: Element | null = el;
      while (current && current !== root) {
        const tag = current.tagName.toLowerCase();
        const className = current.className ? `.${current.className.split(/\s+/)[0]}` : '';
        path.unshift(`${tag}${className}`);
        current = current.parentElement;
      }
      return path.join('>');
    }

    function getRelativeSelector(el: Element, containerSel: string): string {
      const tag = el.tagName.toLowerCase();
      const className = el.className ? `.${el.className.split(/\s+/)[0]}` : '';
      const id = el.id ? `#${el.id}` : '';
      return `${containerSel} ${tag}${id}${className}`.trim();
    }

    function inferType(text: string): string {
      if (!text) return 'text';
      
      // Price detection
      if (/^[$£€¥]\s*[\d,]+\.?\d*$/.test(text) || /^\d+\.?\d*\s*[$£€¥]$/.test(text)) {
        return 'price';
      }
      
      // Number detection
      if (/^\d+\.?\d*$/.test(text)) {
        return 'number';
      }
      
      // Date detection (basic)
      if (/\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}/.test(text) || 
          /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text)) {
        return 'date';
      }
      
      return 'text';
    }

    function sanitizeName(text: string): string {
      return text
        .toLowerCase()
        .substring(0, 30)
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    }

    return fields;
  }, { 
    selector: pattern.selector, 
    includeEmpty: options.includeEmpty,
    confidenceThreshold: options.confidenceThreshold
  });

  return fields;
}
