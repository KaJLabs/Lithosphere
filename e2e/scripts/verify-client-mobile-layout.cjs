// Deterministic browser checks for the client-reported mobile layouts.
const { chromium, webkit, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { applyMobileLayout } = require('../../Makalu/status/mobile-layout.cjs');
const args = process.argv.slice(2);
function option(key, fallback) {
  const index = args.indexOf(key);
  return index < 0 ? fallback : args[index+1];
}
const source = option('--status-html');
const explorer = option('--explorer-base', 'http://localhost:3034');
const output = path.resolve(option('--output', './mobile-layout-results'));
if (!source) throw new Error('Pass --status-html PATH to the deployed status HTML snapshot');
const baseline = fs.readFileSync(source, 'utf8');
const html = args.includes('--before') ? baseline : applyMobileLayout(baseline);
fs.mkdirSync(output, {recursive:true});
const failures = [];
const results = [];
const tokenFixture = {address:'ulitho',name:'Lithosphere',symbol:'LITHO',type:'native',decimals:18,
  totalSupply:'1000000000000000000000000000',holders:2067,transfers:5302761,
  creationBlock:1,description:'Native staking and gas token of the Lithosphere network.'};

(async () => {
  for (const [browserName, engine] of [['chromium',chromium],['webkit',webkit]]) {
    const browser = await engine.launch({headless:true});
    try {
      for (const locale of ['en-US','en-GB']) {
        const context = await browser.newContext({locale,timezoneId:'UTC'});
        const page = await context.newPage();
        const status = {mainnet:{id:'mainnet',name:'LITHO Mainnet',chainId:'9005',blockHeight:12592290,
          avgBlockTime:1150,blockTime:1150,latestBlockTime:'2026-10-19T14:38:09Z',
          statusLevel:'operational',statusMessage:'All monitored endpoints operational',chainFresh:true,
          onlineNodes:6,totalNodes:6,reachableNodes:6,sampledBlocks:10,tps:19.1,nodes:[]}};
        await page.clock.setFixedTime(new Date('2026-10-21T14:38:09Z'));
        await page.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.pathname === '/api/status') return route.fulfill({json:status});
          if (url.pathname === '/api/metrics') return route.fulfill({json:{}});
          if (url.hostname === 'cdn.socket.io') return route.fulfill({contentType:'application/javascript',
            body:'window.io=()=>({on(){},connected:false})'});
          if (url.hostname === 'status.test') return route.fulfill({contentType:'text/html',body:html});
          return route.abort();
        });
        await page.goto('http://status.test');
        await page.locator('.metric-card').first().waitFor();
        for (const width of [320,390,430,768,1440]) {
          await page.setViewportSize({width,height:900});
          const overflow = await page.locator('.metric-card').evaluateAll(cards=>cards.filter(card=>{
            const value=card.querySelector('.metric-value');
            return card.scrollWidth>card.clientWidth+1 || value.scrollWidth>value.clientWidth+1;
          }).map(card=>card.querySelector('.metric-label').textContent));
          const pageOverflow = await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
          results.push({browserName,locale,width,screen:'status',overflow,pageOverflow});
          if (overflow.length || pageOverflow) failures.push(`${browserName}/${locale}/${width}: status overflow ${overflow}`);
          if (width===390) await page.screenshot({path:path.join(output,`status-${browserName}-${locale}.png`),fullPage:true});
        }
        await context.close();
      }
      for (const width of [320,390,430,1440]) {
        const context = await browser.newContext({viewport:{width,height:900}});
        const page = await context.newPage();
        await page.route('**/api/**',route=>{
          const url=new URL(route.request().url());
          if (['/api/tokens/ulitho','/api/tokens/native'].includes(url.pathname)) return route.fulfill({json:tokenFixture});
          if (url.pathname.endsWith('/transfers')) return route.fulfill({json:{transfers:[],total:0,limit:25,offset:0}});
          if (url.pathname.endsWith('/holders')) return route.fulfill({json:{holders:[{
            address:'litho1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqe3n0yx',balance:'299999999000000000000000000',percentage:30}],total:2067,limit:25,offset:0}});
          return route.fulfill({json:{}});
        });
        await page.goto(`${explorer}/token/native`,{waitUntil:'domcontentloaded',timeout:90000});
        const nav=page.getByRole('navigation',{name:'Token tabs',exact:true});
        await nav.waitFor({timeout:60000});
        for (const label of ['Holders','Info','Contract','Transfers']) {
          const button=nav.getByRole('button',{name:new RegExp('^'+label)});
          await button.click();
          await expect(page).toHaveURL(new RegExp(`[?&]tab=${label.toLowerCase()}`));
          const geometry=await nav.evaluate(el=>{
            const scroll=el.parentElement;
            // Horizontal touch drags must not move the tab text vertically.
            scroll.scrollTop=100;
            const navRect=el.getBoundingClientRect(),scrollRect=scroll.getBoundingClientRect();
            return {navHeight:navRect.height,viewportHeight:scroll.clientHeight,scrollTop:scroll.scrollTop,
              buttons:[...el.querySelectorAll('button')].map(b=>b.getBoundingClientRect().height),
              verticallyClipped:navRect.top<scrollRect.top-1 || navRect.bottom>scrollRect.bottom+1};
          });
          results.push({browserName,width,screen:'token',label,...geometry});
          if (geometry.verticallyClipped || geometry.scrollTop || geometry.buttons.some(h=>h<44)) {
            failures.push(`${browserName}/${width}/${label}: clipped or undersized tabs`);
          }
          if (label==='Holders' && width===390) {
            await expect(page.getByText('A total of 2,067 holders found')).toBeVisible();
            await page.screenshot({path:path.join(output,`token-holders-${browserName}.png`)});
          }
        }
        if (await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)) {
          failures.push(`${browserName}/${width}: token page horizontal overflow`);
        }
        await context.close();
      }
    } finally {await browser.close();}
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,failures},null,2));
  console.log(JSON.stringify({checks:results.length,failures},null,2));
  if (failures.length) process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1});
