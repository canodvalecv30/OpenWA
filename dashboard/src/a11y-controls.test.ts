import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';

// Two control patterns here render their caption OUTSIDE the control, so neither gets an accessible
// name for free:
//
//   - `<label class="toggle-switch">` wraps a checkbox plus a decorative slider span and no text, so
//     the wrapping label contributes nothing and screen readers announce an anonymous checkbox.
//   - `<div class="toggle-group">` holding buttons is an exclusive choice whose caption is a sibling
//     and whose selected option lives only in a CSS class.
//
// Checked across every .tsx under src/, not just pages/, because the pattern is copied around: a
// per-page test stays green while the next page, or a shared component, ships the same defect.
//
// Parsed with the TypeScript compiler rather than scanned with regexes. The regex version of this
// file was defeated six different ways, all of them ordinary code rather than deliberate evasion: a
// `className="toggle-switch toggle-switch-sm"` modifier fell out of the sweep; `accept="image/*"`
// opened a comment-strip window that blanked the markup after it (MessageTester's MIME map does
// exactly this, and was silently deleting 5 KB of the file before the scan); a forward search for
// `type="checkbox"` ran past its own element into the next toggle's; and a body slice ending at the
// first `</div>` stopped before the buttons whenever a group opened with a nested div. An AST knows
// what is a string, what is an attribute, and what is actually nested inside what.
//
// Where it cannot verify something it FAILS rather than skipping: a toggle whose control is a
// wrapper component is reported, not quietly passed, because silence is how every one of those
// evasions read.
//
// KNOWN LIMIT, stated rather than papered over: this is static, so it cannot tell whether a caption
// and the control referencing it render under the SAME condition. `aria-labelledby` pointing at a
// span that is behind a different `&&` resolves to nothing at runtime while passing here. The render
// test in pages/Infrastructure.test.ts closes that for the page carrying most of these controls, by
// resolving each reference against a real DOM; the other pages render in their own tests but do
// not resolve these references.
//
// The vacuity floors sit close to today's counts on purpose. They exist to catch the sweep silently
// finding NOTHING (a renamed class, a moved directory), not to pin an exact inventory. Deleting a
// control legitimately is expected to require lowering them, which is a deliberate edit rather than
// a silent loss of coverage.

const SRC = dirname(fileURLToPath(import.meta.url));
const PAGES = join(SRC, 'pages');

/** Every .tsx under src/, recursively: the patterns below are not confined to pages/. */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement;

interface Page {
  file: string;
  source: ts.SourceFile;
}

function pages(): Page[] {
  return tsxFiles(SRC).map(full => {
    const file = full.slice(SRC.length + 1);
    return {
      file,
      source: ts.createSourceFile(file, readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
    };
  });
}

/** Every JSX element in the file, opening tags included, in source order. */
function jsxElements(source: ts.SourceFile): JsxNode[] {
  const out: JsxNode[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) out.push(node);
    ts.forEachChild(node, walk);
  };
  walk(source);
  return out;
}

const opening = (node: JsxNode): ts.JsxOpeningElement | ts.JsxSelfClosingElement =>
  ts.isJsxElement(node) ? node.openingElement : node;

const tagName = (node: JsxNode): string => opening(node).tagName.getText();

function attr(node: JsxNode, name: string): ts.JsxAttribute | undefined {
  return opening(node).attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name,
  );
}

/** A string-literal attribute value, or undefined when it is an expression or absent. */
function literalAttr(node: JsxNode, name: string): string | undefined {
  const found = attr(node, name);
  if (!found?.initializer) return undefined;
  return ts.isStringLiteral(found.initializer) ? found.initializer.text : undefined;
}

/** The attribute's value as written: `"x"` -> `"x"`, `{fieldId}` -> `{fieldId}`. */
function attrText(node: JsxNode, name: string): string | undefined {
  return attr(node, name)?.initializer?.getText();
}

/** The class names on an element, whether written as a literal or a template with a literal head. */
function classes(node: JsxNode): string[] {
  const found = attr(node, 'className');
  if (!found?.initializer) return [];
  const text = ts.isStringLiteral(found.initializer)
    ? found.initializer.text
    : found.initializer.getText().replace(/[`${}'"]/g, ' ');
  return text.split(/\s+/).filter(Boolean);
}

/**
 * The outermost JSX element enclosing `node`: the root of the branch it is returned from. Used to
 * scope a htmlFor lookup, because two branches of the same component can carry the same `{fieldId}`
 * text while only one of them ever renders alongside a given control.
 */
function jsxRoot(node: ts.Node): ts.Node {
  let top = node;
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxFragment(p)) top = p;
  }
  return top;
}

/** Descendants of `node`, excluding itself. */
function descendants(node: JsxNode): JsxNode[] {
  const out: JsxNode[] = [];
  const walk = (n: ts.Node): void => {
    if (n !== node && (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n))) out.push(n);
    ts.forEachChild(n, walk);
  };
  walk(node);
  return out;
}

const line = (source: ts.SourceFile, node: ts.Node): number =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

test('every toggle-switch wraps a checkbox that carries an accessible name', () => {
  const problems: string[] = [];
  let found = 0;

  for (const { file, source } of pages()) {
    for (const node of jsxElements(source)) {
      if (!classes(node).includes('toggle-switch')) continue;
      found++;
      const at = `${file}:${line(source, node)}`;

      const checkboxes = descendants(node).filter(d => literalAttr(d, 'type') === 'checkbox');
      if (checkboxes.length === 0) {
        // Fail closed: a wrapper component may well be labelled correctly, but this test cannot see
        // inside it, and passing on "no checkbox found" is what let an unnamed toggle through before.
        problems.push(
          `${at}: toggle-switch with no inline checkbox to check (control is ${
            descendants(node).map(tagName).join('/') || 'nothing'
          })`,
        );
        continue;
      }

      for (const cb of checkboxes) {
        // The htmlFor branch compares the value as WRITTEN and looks only inside the branch this
        // control is rendered from. Both narrowings matter: accepting "some id and some htmlFor exist
        // in this file" passes a checkbox nothing points at, and searching the whole file lets a
        // sibling branch's identical `{fieldId}` cover for a caption that was just broken.
        const idValue = attrText(cb, 'id');
        const siblings = [jsxRoot(cb), ...descendants(jsxRoot(cb) as JsxNode)].filter(
          (n): n is JsxNode => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n),
        );
        const named =
          attr(cb, 'aria-labelledby') !== undefined ||
          attr(cb, 'aria-label') !== undefined ||
          (idValue !== undefined && siblings.some(l => attrText(l, 'htmlFor') === idValue));
        if (!named) problems.push(`${at}: checkbox has no accessible name`);
      }
    }
  }

  // Vacuity guard: the sweep means nothing if it stopped finding the controls.
  assert.ok(found >= 10, `expected the dashboard to declare toggle switches, found ${found}`);
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('every button toggle-group is a named group whose options report their state', () => {
  const problems: string[] = [];
  let found = 0;

  for (const { file, source } of pages()) {
    for (const node of jsxElements(source)) {
      if (!classes(node).includes('toggle-group')) continue;
      const inside = descendants(node);
      const buttons = inside.filter(d => tagName(d) === 'button');
      // Groups holding a checkbox are the other pattern (caption + switch + status), covered above.
      if (buttons.length === 0 && inside.some(d => literalAttr(d, 'type') === 'checkbox')) continue;

      found++;
      const at = `${file}:${line(source, node)}`;
      if (attr(node, 'role') === undefined) problems.push(`${at}: toggle-group without a role`);
      if (attr(node, 'aria-labelledby') === undefined && attr(node, 'aria-label') === undefined) {
        problems.push(`${at}: toggle-group with no accessible name`);
      }
      if (buttons.length === 0) {
        // Options built by a subcomponent: cannot verify aria-pressed here, so say so.
        problems.push(
          `${at}: toggle-group whose options are not inline buttons (${inside.map(tagName).join('/') || 'empty'})`,
        );
        continue;
      }
      for (const b of buttons) {
        if (attr(b, 'aria-pressed') === undefined) {
          problems.push(`${file}:${line(source, b)}: toggle-group option reports no pressed state`);
        }
      }
    }
  }

  assert.ok(found >= 2, `expected button toggle-groups to exist, found ${found}`);
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('no aria-labelledby points at an id its own file never defines', () => {
  const dangling: string[] = [];
  let refs = 0;

  for (const { file, source } of pages()) {
    const ids = new Set(
      jsxElements(source)
        .map(n => literalAttr(n, 'id'))
        .filter((v): v is string => v !== undefined),
    );
    for (const node of jsxElements(source)) {
      const ref = literalAttr(node, 'aria-labelledby');
      if (ref === undefined) continue;
      refs++;
      if (!ids.has(ref)) dangling.push(`${file}:${line(source, node)}: aria-labelledby="${ref}"`);
    }
  }

  assert.ok(refs > 0, 'expected aria-labelledby references to exist');
  assert.deepEqual(dangling, [], dangling.join('\n'));
});

test('an id referenced by aria-labelledby is defined exactly once in its file', () => {
  const duplicates: string[] = [];

  for (const { file, source } of pages()) {
    const counts = new Map<string, number>();
    for (const node of jsxElements(source)) {
      const id = literalAttr(node, 'id');
      if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const node of jsxElements(source)) {
      const ref = literalAttr(node, 'aria-labelledby');
      // A duplicate id makes the reference ambiguous: the browser resolves the first, which may not
      // be the caption meant for this control.
      if (ref !== undefined && (counts.get(ref) ?? 0) > 1) {
        duplicates.push(`${file}: id="${ref}" defined ${counts.get(ref)} times`);
      }
    }
  }

  assert.deepEqual([...new Set(duplicates)], [], duplicates.join('\n'));
});

/**
 * ConfigField (Plugins) renders one control per schema property and recurses, so caption and control
 * have to be tied together PER INSTANCE, which is why the id comes from React.useId rather than a
 * constant. Only the boolean branch did that; every other field type rendered a bare label beside a
 * control with no id.
 *
 * Walked as an AST for the same reason as above: the regex version of this check looked at the FIRST
 * `<input` in the function, which is the boolean branch's checkbox, so the text/number/secret input
 * (by far the most common plugin field) was never examined at all.
 */
test('every ConfigField caption is bound, and every single control carries the per-instance id', () => {
  const file = 'Plugins.tsx';
  const source = ts.createSourceFile(
    file,
    readFileSync(join(PAGES, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  let fn: ts.Node | undefined;
  const findFn = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.getText() === 'ConfigField') fn = node;
    ts.forEachChild(node, findFn);
  };
  findFn(source);
  assert.ok(fn, 'ConfigField not found');

  const inside: JsxNode[] = [];
  const collect = (n: ts.Node): void => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) inside.push(n);
    ts.forEachChild(n, collect);
  };
  collect(fn);

  const problems: string[] = [];

  // A label with no htmlFor names nothing, whatever other attributes it carries.
  for (const node of inside) {
    if (tagName(node) !== 'label') continue;
    if (classes(node).includes('toggle-switch')) continue; // wraps its control, checked above
    if (attr(node, 'htmlFor') === undefined) {
      problems.push(`${file}:${line(source, node)}: <label> in ConfigField with no htmlFor`);
    }
  }

  // Every single-value control must carry the id those captions point at. Checked per element, not
  // by counting: a count is satisfied by the branch that was already correct.
  let controls = 0;
  for (const node of inside) {
    const tag = tagName(node);
    if (tag !== 'select' && tag !== 'textarea' && tag !== 'input') continue;
    if (literalAttr(node, 'type') === 'checkbox' && attr(node, 'id') !== undefined) {
      controls++;
      continue;
    }
    controls++;
    if (attr(node, 'id') === undefined) {
      problems.push(`${file}:${line(source, node)}: <${tag}> in ConfigField has no id`);
    }
  }

  assert.ok(controls >= 4, `expected ConfigField to render controls, found ${controls}`);
  assert.deepEqual(problems, [], problems.join('\n'));
});

/**
 * The three cases above cover the patterns this dashboard invented. This one covers the ordinary
 * ones: a bare `<select>` or `<input>` whose caption is a sibling rather than a label gets no
 * accessible name either, and nothing here was watching for it. Seven shipped that way.
 *
 * A control is considered named by aria-label, aria-labelledby, an id some label points at, an
 * enclosing <label> (which names it through its own text), or a placeholder. Placeholder is accepted
 * because it does produce a name, while noting it is a weak one: it disappears on input and WCAG
 * does not treat it as a label substitute.
 *
 * `display: none` controls are exempt and must say so: the file inputs behind an upload button are
 * never reached by assistive tech, and the button carries the name.
 */
test('every native control is named, or is hidden from assistive tech', () => {
  const unnamed: string[] = [];
  let checked = 0;

  for (const { file, source } of pages()) {
    const all = jsxElements(source);
    const labelTargets = new Set(all.map(n => attrText(n, 'htmlFor')).filter((v): v is string => v !== undefined));

    for (const node of all) {
      const tag = tagName(node);
      if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') continue;
      const type = literalAttr(node, 'type');
      if (type === 'hidden' || type === 'submit' || type === 'button') continue;

      // Not rendered to anyone, so it has no name to give; the trigger button carries it.
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      if (/display:\s*'none'/.test(opening.getText())) continue;

      checked++;
      const id = attrText(node, 'id');
      const named =
        attr(node, 'aria-label') !== undefined ||
        attr(node, 'aria-labelledby') !== undefined ||
        attr(node, 'placeholder') !== undefined ||
        (id !== undefined && labelTargets.has(id));
      if (named) continue;

      // A wrapping <label> names it through its own text.
      let parent: ts.Node | undefined = node.parent;
      let wrapped = false;
      while (parent) {
        if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText() === 'label') {
          wrapped = true;
          break;
        }
        parent = parent.parent;
      }
      if (!wrapped) unnamed.push(`${file}:${line(source, node)} <${tag}>`);
    }
  }

  assert.ok(checked >= 80, `expected the dashboard to declare native controls, found ${checked}`);
  assert.deepEqual(unnamed, [], unnamed.join('\n'));
});
