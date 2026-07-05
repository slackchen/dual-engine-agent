import { ipcMain, shell } from 'electron';
import http from 'node:http';

export function registerAuthHandlers() {
  ipcMain.handle('agent:login-oauth', async () => {
    return new Promise((resolve, reject) => {
      const port = 51121;
      const server = http.createServer(async (req, res) => {
        try {
          // 1. Mock OAuth Provider Authorization Page
          if (req.url?.startsWith('/authorize')) {
             const urlObj = new URL(`http://localhost:${port}${req.url}`);
             const redirectUri = urlObj.searchParams.get('redirect_uri');
             
             res.writeHead(200, { 'Content-Type': 'text/html' });
             res.end(`
               <html>
                 <head><title>Antigravity OAuth Mock</title></head>
                 <body style="font-family: sans-serif; padding: 50px; text-align: center;">
                   <h2>Mock Antigravity OAuth Server</h2>
                   <p>Do you want to authorize <b>Dual-Engine Desktop</b>?</p>
                   <button onclick="window.location.href='${redirectUri}?code=mock_code_888999'" style="padding: 10px 20px; font-size: 16px; cursor: pointer;">Approve</button>
                 </body>
               </html>
             `);
          }
          // 2. Client Callback Endpoint
          else if (req.url?.startsWith('/oauth-callback')) {
             const urlObj = new URL(`http://localhost:${port}${req.url}`);
             const code = urlObj.searchParams.get('code');
             const error = urlObj.searchParams.get('error');
             
             if (error) throw new Error(`OAuth Error: ${error}`);
             if (!code) throw new Error('No code found in redirect');
             
             // Exchange code for Access Token using Google Token Endpoint
             const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                 body: new URLSearchParams({
                    code: code,
                    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || 'YOUR_CLIENT_ID',
                    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || 'YOUR_CLIENT_SECRET',
                    redirect_uri: `http://localhost:${port}/oauth-callback`,
                    grant_type: 'authorization_code'
                 })
             });
             
             const tokenData = await tokenResponse.json();
             
             if (!tokenResponse.ok) {
                throw new Error(tokenData.error_description || tokenData.error || 'Failed to exchange token');
             }

             const accessToken = tokenData.access_token;
             
             res.writeHead(200, { 'Content-Type': 'text/html' });
             res.end('<h1>Google Login Successful!</h1><p>You can close this window and return to the Dual-Engine Agent.</p><script>setTimeout(()=>window.close(),2000)</script>');
             
             server.close();
             resolve(accessToken);
          } else {
             res.writeHead(404);
             res.end('Not Found');
          }
        } catch (err: any) {
          res.writeHead(500);
          res.end(`Error: ${err.message}`);
          server.close();
          reject(err);
        }
      });

      server.on('error', (err: any) => {
         if (err.code === 'EADDRINUSE') {
           reject(new Error('OAuth flow is already in progress.'));
         } else {
           reject(err);
         }
      });

      server.listen(port, () => {
         const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || 'YOUR_CLIENT_ID';
         const redirectUri = `http://localhost:${port}/oauth-callback`;
         const scope = 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
         const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}`;
         shell.openExternal(authUrl);
      });
      
      setTimeout(() => {
         server.close();
         reject(new Error('OAuth Login Timeout after 60s'));
      }, 60000);
    });
  });
}
