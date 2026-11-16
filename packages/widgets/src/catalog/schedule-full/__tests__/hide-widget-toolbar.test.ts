import { describe, it, expect, beforeEach } from 'vitest';
import { css } from '../hide-widget-toolbar';

/**
 * CONTRACT — hide-widget-toolbar's css, in the schedule widget's shadow
 * root. The host draws its own title and schedule controls, so the
 * widget's header block goes: the block that holds the title
 * (.widget-title), the subtitle and the button bar. The block itself is
 * hidden, not only what is in it, so the block's own bottom margin
 * (20px in the widget's CSS) leaves with it and the host's spacing above
 * the schedule holds. Nothing in the events area is hidden. The rule names
 * no hashed class: the widget's class names change with every build.
 */

/** The widget's markup around its header, with hashed class names as a build makes them. */
function drawWidget() {
  document.body.innerHTML = `
    <style>.header___b2 { margin-bottom: 20px; }</style>
    <style>${css}</style>
    <div class="outerWrapper___a1 full-schedule-widget">
      <div class="header___b2" id="header">
        <div class="title___c3 widget-title" id="title">Schedule</div>
        <div class="subtitle___d4 widget-subtitle" id="subtitle"><span>Subtitle</span></div>
        <div class="wrapper___e5" id="button-bar"><div class="buttonGroup___f6"><button>Print</button></div></div>
      </div>
      <div class="innerWrapper___g7" id="events">
        <div class="header___h8"><div class="title___i9">Keynote</div></div>
        <div class="eventInfo___j0"><button>Add to My Schedule</button></div>
      </div>
    </div>`;
}

const byId = (id: string) => document.getElementById(id)!;

/** Whether the element and every block around it show. */
function shown(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (getComputedStyle(node).display === 'none') return false;
  }
  return true;
}

beforeEach(() => {
  drawWidget();
});

describe('the widget header', () => {
  it('the block that holds the title is hidden itself, so its bottom margin leaves with it', () => {
    expect(getComputedStyle(byId('header')).display).toBe('none');
  });

  it('the title, the subtitle and the button bar do not show', () => {
    for (const id of ['title', 'subtitle', 'button-bar']) expect(shown(byId(id)), id).toBe(false);
  });
});

describe('the events area', () => {
  it('nothing in it is hidden, also its own header and title blocks', () => {
    const events = byId('events');
    for (const element of [events, ...events.querySelectorAll('*')]) expect(shown(element), element.className).toBe(true);
  });
});

describe('the rule', () => {
  it('names no hashed class', () => {
    expect(css).not.toMatch(/\.[\w-]+___[\w-]+/);
  });
});
