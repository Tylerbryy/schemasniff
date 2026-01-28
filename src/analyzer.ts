import { chromium, type Page } from 'playwright';
import { getInjectableUtilityLogic } from './utils/utility-classes.js';
import { CONFIG } from './utils/constants.js';
import { AnalyzerError } from './utils/errors.js';

// ============================================================================
// Types
// ============================================================================

export interface AnalyzerOptions {
  minItems: number;
  maxDepth: number;
  fieldTypes: FieldType[];
  includeEmpty: boolean;
  enableJs: boolean;
  confidenceThreshold: number;
}

export type FieldType = 'text' | 'href' | 'url' | 'number' | 'date' | 'price';

export interface Field {
  name: string;
  selector: string;
  type: FieldType;
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

interface PatternSample {
  html: string;
  text: string | undefined;
  childCount: number;
}

interface DOMPattern {
  selector: string;
  count: number;
  depth: number;
  samples: PatternSample[];
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function analyzeUrl(url: string, options: AnalyzerOptions): Promise<Schema> {
  // Validate URL
  try {
    new URL(url);
  } catch {
    throw AnalyzerError.invalidUrl(url);
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    throw AnalyzerError.browserError(e);
  }

  const page = await browser.newPage();

  try {
    const response = await page.goto(url, {
      waitUntil: options.enableJs ? 'networkidle' : 'domcontentloaded',
      timeout: CONFIG.NAVIGATION_TIMEOUT
    });

    if (!response?.ok()) {
      throw AnalyzerError.pageLoadFailed(response?.status(), url);
    }

    // Find repeated patterns in the DOM
    const patterns = await findRepeatedPatterns(page, options);

    // Select the most promising pattern
    const bestPattern = selectBestPattern(patterns, options);

    if (!bestPattern) {
      throw AnalyzerError.noPatternsFound(url, options.minItems);
    }

    // Infer field types for the pattern
    let fields = await inferFields(page, bestPattern, options);

    // Filter by requested field types
    if (options.fieldTypes.length > 0) {
      fields = fields.filter(f => options.fieldTypes.includes(f.type));
    }

    // Deduplicate field names
    fields = deduplicateFields(fields);

    // Calculate overall confidence
    const confidence = calculateConfidence(bestPattern, fields, options);

    const schema: Schema = {
      url,
      timestamp: new Date().toISOString(),
      containerSelector: bestPattern.selector,
      fields,
      itemCount: bestPattern.count,
      confidence
    };

    return schema;
  } catch (e) {
    if (e instanceof AnalyzerError) throw e;
    throw AnalyzerError.navigationError(url, e);
  } finally {
    await browser.close();
  }
}

// ============================================================================
// Pattern Detection
// ============================================================================

async function findRepeatedPatterns(page: Page, options: AnalyzerOptions): Promise<DOMPattern[]> {
  const utilityLogic = getInjectableUtilityLogic();

  const patterns = await page.evaluate(
    ({ minItems, maxHtmlPreview, maxTextPreview, containerTags, utilityLogic }) => {
      // Inject utility class detection logic
      eval(utilityLogic);

      // @ts-expect-error - getSemanticClasses is injected via eval
      const _getSemanticClasses = getSemanticClasses;

      const results: any[] = [];

      function classIntersection(classes1: string[], classes2: string[]): string[] {
        const set2 = new Set(classes2);
        return classes1.filter(cls => set2.has(cls));
      }

      function getDepth(el: Element): number {
        let depth = 0;
        let current: Element | null = el;
        while (current && current.parentElement) {
          depth++;
          current = current.parentElement;
        }
        return depth;
      }

      containerTags.forEach((tag: string) => {
        const elements = Array.from(document.querySelectorAll(tag));
        if (elements.length < minItems) return;

        const groups: { classes: string[]; elements: Element[] }[] = [];

        elements.forEach(el => {
          const semanticClasses = _getSemanticClasses(el);
          if (semanticClasses.length === 0) return;

          let bestGroup: { classes: string[]; elements: Element[] } | null = null;
          let bestIntersection: string[] = [];

          for (const group of groups) {
            const intersection = classIntersection(semanticClasses, group.classes);
            if (intersection.length >= 1 && intersection.length > bestIntersection.length) {
              bestGroup = group;
              bestIntersection = intersection;
            }
          }

          if (bestGroup && bestIntersection.length >= 1) {
            bestGroup.classes = bestIntersection;
            bestGroup.elements.push(el);
          } else {
            groups.push({ classes: semanticClasses, elements: [el] });
          }
        });

        groups.forEach(group => {
          if (group.elements.length >= minItems && group.classes.length >= 1) {
            const selector = `${tag}.${group.classes.join('.')}`;
            const samples = group.elements.slice(0, 3).map(el => ({
              html: el.outerHTML.substring(0, maxHtmlPreview),
              text: el.textContent?.substring(0, maxTextPreview),
              childCount: el.children.length
            }));

            results.push({
              selector,
              count: group.elements.length,
              depth: getDepth(group.elements[0]),
              samples
            });
          }
        });
      });

      return results;
    },
    {
      minItems: options.minItems,
      maxHtmlPreview: CONFIG.MAX_HTML_PREVIEW,
      maxTextPreview: CONFIG.MAX_TEXT_PREVIEW,
      containerTags: CONFIG.CONTAINER_TAGS,
      utilityLogic
    }
  );

  return patterns;
}

// ============================================================================
// Pattern Scoring & Selection
// ============================================================================

function selectBestPattern(patterns: DOMPattern[], options: AnalyzerOptions): DOMPattern | null {
  if (patterns.length === 0) return null;

  // Filter by maxDepth
  const filtered = patterns.filter(p => p.depth <= options.maxDepth);
  if (filtered.length === 0) return null;

  const scored = filtered.map(p => {
    let score = 0;

    // Count score (logarithmic - more items is better)
    score += Math.log(p.count) * 10;

    // Depth score (prefer moderate depth)
    const depthScore = Math.max(0, 10 - Math.abs(p.depth - CONFIG.IDEAL_DOM_DEPTH) * 2);
    score += depthScore;

    return { pattern: p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].pattern;
}

// ============================================================================
// Field Inference
// ============================================================================

async function inferFields(
  page: Page,
  pattern: DOMPattern,
  options: AnalyzerOptions
): Promise<Field[]> {
  const utilityLogic = getInjectableUtilityLogic();

  const fields = await page.evaluate(
    ({ selector, includeEmpty, confidenceThreshold, sampleCount, maxFieldNameLength, utilityLogic }) => {
      // Inject utility class detection logic
      eval(utilityLogic);

      // @ts-expect-error - functions are injected via eval
      const _getSemanticClassSelector = getSemanticClassSelector;

      const containers = Array.from(document.querySelectorAll(selector));
      if (containers.length === 0) return [];

      const fieldMap = new Map<string, {
        name: string;
        type: string;
        selector: string;
        samples: string[];
      }>();

      function addToMap(key: string, name: string, type: string, el: Element, sample: string) {
        if (!fieldMap.has(key)) {
          fieldMap.set(key, {
            name,
            type,
            selector: getRelativeSelector(el, selector),
            samples: []
          });
        }
        fieldMap.get(key)!.samples.push(sample);
      }

      function getElementPath(el: Element, root: Element): string {
        const path: string[] = [];
        let current: Element | null = el;
        while (current && current !== root) {
          const tag = current.tagName.toLowerCase();
          const semClass = _getSemanticClassSelector(current);
          path.unshift(`${tag}${semClass}`);
          current = current.parentElement;
        }
        return path.join('>');
      }

      function getRelativeSelector(el: Element, containerSel: string): string {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const semClass = _getSemanticClassSelector(el);
        return `${containerSel} ${tag}${id}${semClass}`.trim();
      }

      function inferType(text: string): string {
        if (!text) return 'text';
        // Price: $99.99, £50, €100, ¥1000
        if (/^[$£€¥]\s*[\d,]+\.?\d*$/.test(text) || /^\d+\.?\d*\s*[$£€¥]$/.test(text)) {
          return 'price';
        }
        // Number
        if (/^\d+\.?\d*$/.test(text)) return 'number';
        // Date
        if (/\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}/.test(text) ||
            /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text)) {
          return 'date';
        }
        return 'text';
      }

      function sanitizeName(text: string): string {
        return text
          .toLowerCase()
          .substring(0, maxFieldNameLength)
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
      }

      // Analyze sample containers
      containers.slice(0, sampleCount).forEach(container => {
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_ELEMENT,
          null
        );

        let node: Node | null;
        while ((node = walker.nextNode())) {
          const el = node as Element;
          const tagName = el.tagName.toLowerCase();

          if (tagName === 'script' || tagName === 'style') continue;

          // Links
          if (tagName === 'a' && el.hasAttribute('href')) {
            const href = el.getAttribute('href') || '';
            const text = el.textContent?.trim() || '';
            if (text || includeEmpty) {
              const key = `link_${getElementPath(el, container)}`;
              addToMap(key, text ? sanitizeName(text) : 'link', 'href', el, href);
            }
          }

          // Images
          if (tagName === 'img' && el.hasAttribute('src')) {
            const src = el.getAttribute('src') || '';
            const alt = el.getAttribute('alt') || 'image';
            const key = `img_${getElementPath(el, container)}`;
            addToMap(key, sanitizeName(alt), 'url', el, src);
          }

          // Text content (leaf nodes only)
          if (el.children.length === 0) {
            const text = el.textContent?.trim() || '';
            if (text || includeEmpty) {
              const type = inferType(text);
              const key = `${type}_${getElementPath(el, container)}`;
              const name = text ? sanitizeName(text) : tagName;
              addToMap(key, name, type, el, text);
            }
          }
        }
      });

      // Convert to fields array with confidence filtering
      const fields: any[] = [];
      fieldMap.forEach(data => {
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

      return fields;
    },
    {
      selector: pattern.selector,
      includeEmpty: options.includeEmpty,
      confidenceThreshold: options.confidenceThreshold,
      sampleCount: CONFIG.SAMPLE_COUNT,
      maxFieldNameLength: CONFIG.MAX_FIELD_NAME_LENGTH,
      utilityLogic
    }
  );

  return fields;
}

// ============================================================================
// Confidence Calculation
// ============================================================================

function calculateConfidence(
  pattern: DOMPattern,
  fields: Field[],
  options: AnalyzerOptions
): number {
  if (fields.length === 0) return 0;

  let score = 0;

  // Factor 1: Item count relative to minimum (30% weight)
  // Normalize: 1x minimum = 0.5, 2x+ minimum = 1.0
  const countRatio = Math.min(pattern.count / options.minItems / 2, 1);
  score += countRatio * 0.3;

  // Factor 2: Average field confidence (40% weight)
  const avgFieldConfidence = fields.reduce((sum, f) => sum + f.confidence, 0) / fields.length;
  score += avgFieldConfidence * 0.4;

  // Factor 3: Number of fields detected (30% weight)
  // Having 5+ fields is considered ideal
  const fieldScore = Math.min(fields.length / 5, 1);
  score += fieldScore * 0.3;

  return Math.round(score * 100) / 100;
}

// ============================================================================
// Field Deduplication
// ============================================================================

function deduplicateFields(fields: Field[]): Field[] {
  const seen = new Map<string, number>();

  return fields.map(field => {
    const count = seen.get(field.name) || 0;
    seen.set(field.name, count + 1);

    if (count > 0) {
      return { ...field, name: `${field.name}_${count}` };
    }
    return field;
  });
}
