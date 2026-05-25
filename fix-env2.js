const https = require('https');
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const key = require('C:/Users/anasr/Downloads/bonvoy-d2b12-firebase-adminsdk-fbsvc-f9dd8ca749.json').private_key;
const accountId = '697f7a85e6f1a6cadb2e338a';
const siteId = '9e65b9d3-d0bf-48b1-bb29-ca7f334511a1';
console.log('Key loaded, length:', key.length);
function apiRequest(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = { hostname: 'api.netlify.com', path, method, headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(options, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
async function run(token) {
  const basePath = '/api/v1/accounts/' + accountId + '/env/FIREBASE_PRIVATE_KEY?site_id=' + siteId;
  const body = JSON.stringify({ value: key, context: 'production' });
  let res = await apiRequest('PATCH', basePath, token, { value: key, context: 'production' });
  console.log('PATCH status:', res.status, res.body.substring(0, 150));
  if (res.status === 200 || res.status === 201) { console.log('SUCCESS! Now run: git commit --allow-empty -m "redeploy" && git push origin main'); return; }
  console.log('PATCH failed, trying DELETE + POST...');
  res = await apiRequest('DELETE', basePath, token, null);
  console.log('DELETE status:', res.status);
  res = await apiRequest('POST', '/api/v1/accounts/' + accountId + '/env?site_id=' + siteId, token, [{ key: 'FIREBASE_PRIVATE_KEY', scopes: ['functions', 'runtime'], values: [{ value: key, context: 'production' }] }]);
  console.log('POST status:', res.status, res.body.substring(0, 150));
  if (res.status === 200 || res.status === 201) { console.log('SUCCESS! Now run: git commit --allow-empty -m "redeploy" && git push origin main'); }
}
rl.question('Paste new Netlify token: ', (token) => { rl.close(); run(token.trim()).catch(console.error); });
