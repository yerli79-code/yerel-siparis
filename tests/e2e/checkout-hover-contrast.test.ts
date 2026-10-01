import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BrowserCDPClient } from "./browser-cdp-helper";

// Standalone checkout fixture: real global cascade and checkout ancestors,
// no application JS, form, API, credentials, or order submission.
const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const cards = [
  { id: "delivery", heading: "Teslimat", description: "Adresime gelsin" },
  { id: "pickup", heading: "Gel-Al", description: "Hazır olduğunda alacağım" },
];
const html = `<style>${css}</style><main class="public-order-page">
  <div class="public-order-shell public-order-checkout-page">
    <div class="public-order-checkout-grid"><div class="public-order-checkout-main">
      <section class="public-order-checkout-section public-order-type-field">
        <div class="order-type-toggle public-order-type-toggle" role="group" aria-label="Sipariş türü">
          ${cards.map(({ id, heading, description }) => `<button id="${id}" type="button"
            aria-pressed="false" class="order-type-button public-order-type-button">
            <span class="public-order-type-icon" aria-hidden="true">✓</span>
            <span class="public-order-type-copy"><strong>${heading}</strong><small>${description}</small></span>
            <span class="public-order-type-check" aria-hidden="true">✓</span></button>`).join("")}
        </div>
      </section>
    </div></div>
  </div></main><button id="legacy" type="button" class="order-type-button selected">Legacy</button>`;

type Sample = {
  background: string; border: string; borderWidth: string; description: string;
  headingContrast: number; descriptionContrast: number; hover: boolean;
  focusVisible: boolean; outline: string; outlineWidth: string; disabled: boolean;
};

async function sample(client: BrowserCDPClient, id: string): Promise<Sample> {
  return client.evaluate(`(() => {
    const button = document.getElementById(${JSON.stringify(id)});
    const style = getComputedStyle(button);
    const parse = color => color.match(/[\\d.]+/g).map(Number);
    const over = (foreground, background) => {
      const alpha = foreground[3] ?? 1;
      return foreground.slice(0, 3).map((value, i) => value * alpha + background[i] * (1 - alpha));
    };
    // Composite every computed ancestor background, including the translucent
    // selected card, onto the white browser canvas. Do not round before WCAG math.
    const ancestors = [];
    for (let node = button; node; node = node.parentElement) ancestors.unshift(node);
    let background = [255, 255, 255];
    for (const node of ancestors) background = over(parse(getComputedStyle(node).backgroundColor), background);
    const luminance = rgb => rgb.map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
    const contrast = color => {
      const text = luminance(over(parse(color), background));
      const bg = luminance(background);
      return (Math.max(text, bg) + 0.05) / (Math.min(text, bg) + 0.05);
    };
    const heading = getComputedStyle(button.querySelector('strong')).color;
    const description = getComputedStyle(button.querySelector('small')).color;
    return { background: style.backgroundColor, border: style.borderTopColor,
      borderWidth: style.borderTopWidth, description, headingContrast: contrast(heading),
      descriptionContrast: contrast(description), hover: button.matches(':hover'),
      focusVisible: button.matches(':focus-visible'), outline: style.outlineStyle,
      outlineWidth: style.outlineWidth, disabled: button.disabled };
  })()`);
}

async function move(client: BrowserCDPClient, id?: string) {
  // Chromium's CSS domain activates the actual pseudo-class cascade in headless
  // mode (independent of the desktop pointer); all assertions use computed styles.
  const root = (await client.send("DOM.getDocument")).root.nodeId;
  for (const target of [...cards.map(card => card.id), "legacy"]) {
    const { nodeId } = await client.send("DOM.querySelector", { nodeId: root, selector: `#${target}` });
    await client.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: target === id ? ["hover"] : [] });
  }
  const point = id ? await client.evaluate<{ x: number; y: number }>(`(() => {
    const element = document.getElementById(${JSON.stringify(id)});
    element.scrollIntoView({ block: 'center' });
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`) : { x: 0, y: 0 };
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  // Let the production 150ms transition settle before sampling.
  await new Promise(resolve => setTimeout(resolve, 250));
}

function selectedPass(value: Sample) {
  assert.equal(value.background, "rgba(220, 235, 199, 0.35)");
  assert.equal(value.border, "rgb(9, 93, 39)");
  assert.equal(value.borderWidth, "2px");
  assert.equal(value.description, "rgb(104, 112, 125)");
  assert.ok(value.headingContrast >= 4.5, `Heading contrast ${value.headingContrast}`);
  assert.ok(value.descriptionContrast >= 4.5, `Description contrast ${value.descriptionContrast}`);
}

test("both public fulfillment cards retain selected colors and AA contrast across browser states", async () => {
  const client = new BrowserCDPClient();
  try {
    await client.launch({ port: 9224 });
    await client.setViewport(1280, 1000);
    await client.send("Page.bringToFront");
    await client.send("CSS.enable");
    await client.send("Page.setDocumentContent", {
      frameId: (await client.send("Page.getFrameTree")).frameTree.frame.id, html,
    });
    for (const { id, heading } of cards) {
      await move(client);
      const normal = await sample(client, id);
      assert.equal(normal.hover, false);
      assert.equal(normal.background, "rgb(255, 255, 255)");
      assert.equal(normal.border, "rgb(226, 232, 240)");
      assert.equal(normal.borderWidth, "1px");
      assert.equal(normal.description, "rgb(107, 114, 128)");
      await move(client, id);
      const hover = await sample(client, id);
      assert.equal(hover.background, "rgb(249, 250, 251)");
      assert.equal(hover.border, normal.border);
      await move(client);
      await client.evaluate(`document.getElementById('${id}').classList.add('selected'); document.getElementById('${id}').setAttribute('aria-pressed', 'true')`);
      await move(client);
      const selected = await sample(client, id);
      selectedPass(selected);
      assert.equal(selected.hover, false);
      await move(client, id);
      const selectedHover = await sample(client, id);
      selectedPass(selectedHover);
      await move(client);
      await client.pressKey("Tab", "Tab", 9);
      await client.evaluate(`document.getElementById('${id}').focus()`);
      const focus = await sample(client, id);
      assert.equal(focus.focusVisible, true);
      assert.equal(focus.outline, "solid");
      assert.equal(focus.outlineWidth, "3px");
      selectedPass(focus);
      await client.evaluate(`document.getElementById('${id}').disabled = true`);
      await move(client, id);
      const disabled = await sample(client, id);
      assert.equal(disabled.disabled, true);
      assert.equal(disabled.focusVisible, false);
      selectedPass(disabled);
      await client.evaluate(`window.fixtureClicks = 0; document.getElementById('${id}').onclick = () => window.fixtureClicks++`);
      await client.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1,
        ...await client.evaluate(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`) });
      await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1,
        ...await client.evaluate(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`) });
      assert.equal(await client.evaluate("window.fixtureClicks"), 0);
      await client.evaluate(`document.getElementById('${id}').disabled = false; document.getElementById('${id}').classList.remove('selected'); document.getElementById('${id}').setAttribute('aria-pressed', 'false')`);
      console.log(`${heading}: normal/hover/selected/selected+hover/focus-visible/disabled PASS; heading=${selectedHover.headingContrast.toFixed(2)}:1; description=${selected.descriptionContrast.toFixed(2)}:1`);
    }
    await move(client, "legacy");
    const legacy = await client.evaluate(`(() => { const s = getComputedStyle(document.getElementById('legacy')); return { background: s.backgroundColor, border: s.borderTopColor }; })()`);
    assert.equal(legacy.background, "rgb(15, 113, 133)");
    assert.equal(legacy.border, "rgb(15, 113, 133)");

    // Prove sensitivity to both approved fixes using the pre-fix cascade in
    // the same isolated browser fixture, without editing application files.
    await client.send("Page.setDocumentContent", {
      frameId: (await client.send("Page.getFrameTree")).frameTree.frame.id,
      html: html.replace(".selected:not(.public-order-type-button):hover", ".selected:hover")
        .replace("color: #68707d;", "color: #6b7280;"),
    });
    await client.evaluate("document.getElementById('pickup').classList.add('selected')");
    await move(client);
    const beforeSelected = await sample(client, "pickup");
    assert.ok(beforeSelected.descriptionContrast < 4.5, "Old selected description must fail AA");
    await move(client, "pickup");
    const beforeHover = await sample(client, "pickup");
    assert.notEqual(beforeHover.background, "rgba(220, 235, 199, 0.35)");
    assert.notEqual(beforeHover.border, "rgb(9, 93, 39)");
    assert.ok(beforeHover.headingContrast < 4.5, "Old selected hover heading must fail AA");
    assert.ok(beforeHover.descriptionContrast < 4.5, "Old selected hover description must fail AA");
    console.log(`Pre-fix sensitivity PASS: selected description=${beforeSelected.descriptionContrast.toFixed(2)}:1; hover heading=${beforeHover.headingContrast.toFixed(2)}:1; hover description=${beforeHover.descriptionContrast.toFixed(2)}:1`);
    assert.equal(client.networkLogs.length, 0, "Fixture must never submit an order or load a network resource");
    assert.equal(client.egressViolation, false);
    assert.equal(client.consoleLogs.filter(entry => entry.type === "error").length, 0);
  } finally {
    await client.close();
  }
});
