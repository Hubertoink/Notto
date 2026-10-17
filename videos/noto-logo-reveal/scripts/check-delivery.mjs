import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const browser=await chromium.launch({headless:true});
try {
  const url=pathToFileURL(resolve('delivery/preview.html')).href;
  const page=await browser.newPage({viewport:{width:1280,height:820}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(()=>document.querySelector('video').currentTime>0.15);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  assert.equal(await page.locator('video').evaluate(video=>video.paused),true);
  const metadata=await page.locator('video').evaluate(video=>({width:video.videoWidth,height:video.videoHeight,duration:video.duration,muted:video.muted,source:video.currentSrc.split('/').pop()}));
  assert.equal(metadata.width,1920);assert.equal(metadata.height,1080);assert.equal(metadata.duration,3);assert.equal(metadata.muted,true);
  assert.deepEqual(errors,[]);
  const reduced=await browser.newPage({viewport:{width:390,height:700},reducedMotion:'reduce'});
  await reduced.goto(url);
  assert.equal(await reduced.locator('#still').isVisible(),true);
  assert.equal(await reduced.locator('video').isVisible(),false);
  assert.equal(await reduced.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await reduced.getByRole('button',{name:'Abspielen',exact:true}).click();
  await reduced.waitForFunction(()=>document.querySelector('video').currentTime>0);
  console.log(JSON.stringify({playback:metadata,pauseButton:'passed',reducedMotion:'passed',mobileOverflow:false,errors}));
} finally {await browser.close();}
