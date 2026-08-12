// Runnable smoke test / usage template for connect.js.
// Assumes WeChat DevTools already has nano-miniapp open with automation
// enabled on DEFAULT_PORT (see README "Quick start"). Run with:
//   node example.js
'use strict';

const { connect, launch, DEFAULT_PORT } = require('./connect');

async function main() {
  // Reuse an already-running automation session (fast path):
  let mp;
  try {
    mp = await connect(DEFAULT_PORT);
  } catch (e) {
    // Nothing listening on that port yet — do a full launch instead.
    mp = await launch({ port: DEFAULT_PORT });
  }

  await mp.reLaunch('/pages/main/main');
  await new Promise((r) => setTimeout(r, 1500));

  const page = await mp.currentPage();
  console.log('current page:', page.path);

  // Read/patch page data directly — far more reliable than driving the UI
  // with taps for setting up a specific test state.
  const data = await page.data();
  console.log('logged in as:', data.user && data.user.nickname);

  // Query an element and inspect its box/scroll state.
  const scroller = await page.$('.dots-subtab-scroll');
  if (scroller) {
    const size = await scroller.size();
    const scrollHeight = await scroller.scrollHeight();
    console.log(`dots-subtab-scroll: viewport=${size.height} content=${scrollHeight}`);

    // IMPORTANT: synthetic touchstart/touchmove/touchend do NOT reliably
    // trigger real scroll-view scrolling in this automator/simulator combo
    // (confirmed via a control test on a known-working scroll-view — zero
    // movement from synthetic touch). Use the element's scrollTo() API
    // instead, and verify with .property('scrollTop').
    await scroller.scrollTo(0, 200);
    await new Promise((r) => setTimeout(r, 300));
    const scrollTop = await scroller.property('scrollTop');
    console.log('scrollTop after scrollTo(0,200):', scrollTop);
  }

  await mp.disconnect();
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
