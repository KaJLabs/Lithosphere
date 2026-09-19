import { defineConfig } from '@playwright/test';
const port=Number(process.env.MULTX_REVIEW_WEB_PORT||4178);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('invalid MULTX_REVIEW_WEB_PORT');
const baseURL=`http://127.0.0.1:${port}`;
export default defineConfig({
 testDir:'./tests/e2e',testMatch:'native-recovery.spec.js',workers:1,timeout:180000,
 use:{baseURL,headless:true},
 webServer:{command:`node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --strictPort`,url:baseURL,timeout:120000,reuseExistingServer:false},
 projects:[{name:'chromium',use:{browserName:'chromium'}}]
});
