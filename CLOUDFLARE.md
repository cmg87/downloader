# Remote access with Cloudflare Access

The app has no sign-in of its own. Keep the app process on the computer that will download and save the files, and use Cloudflare Access to require your identity before requests reach it.

The current setup uses this route:

```text
https://dl.ischrisworking.com
        ↓ Cloudflare Access
        ↓ Cloudflare Tunnel
http://localhost:43827
```

## Start the app

From the repository folder, run `bash install.sh` once. It builds the production app and keeps it running as the PM2 process `downloader`. Check it locally at [http://localhost:43827](http://localhost:43827). After a reboot, PM2 must be configured with `pm2 startup` (once per computer); follow the command PM2 prints and then run `pm2 save`.

## Cloudflare Tunnel

In the Cloudflare dashboard, open **Networking > Tunnels**, select the tunnel running on the app computer, and add or check its published application route:

- Hostname: `dl.ischrisworking.com` (or your own hostname)
- Service: `http://localhost:43827`

`cloudflared` must run on the same computer as the app for `localhost` to point to the right place. The route sends HTTPS requests from the public hostname through the tunnel to the local HTTP app. Cloudflare’s [Tunnel guide](https://developers.cloudflare.com/tunnel/get-started/) describes published application routes.

## Cloudflare Access

Create a **Self-hosted** Access application for the same hostname, `dl.ischrisworking.com`, and add an **Allow** policy restricted to your own email address (or the narrow identity group you use). Make sure the policy applies to this hostname and that your chosen identity provider is available for sign-in. Test in a private/incognito browser window: an unauthenticated visitor should see Cloudflare Access sign-in, and your account should reach the downloader after signing in.

Do not add a broad `Everyone` allow rule. Cloudflare Access protects requests that go through this hostname; it does not add a login screen to the app itself or protect a separate direct connection to the computer’s local/LAN address. Cloudflare’s [self-hosted app setup](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) covers the application and policy configuration.

Choose an Access session duration that suits your use. The app stores its Instagram session on the app computer; Cloudflare Access and Instagram sessions are separate.

## Use Tailscale instead

If you do not want a public hostname, Tailscale Serve can provide private HTTPS access to devices in your tailnet. Install and sign in to Tailscale on the app computer and phone, then run:

```bash
tailscale serve --bg 43827
tailscale serve status
```

Open the HTTPS URL shown in the status output on a device signed in to the same tailnet. Tailscale Serve proxies to the app on port `43827`; tailnet access controls continue to apply. This keeps the app private to your tailnet. Do not enable Tailscale Funnel for this private setup. See the [Tailscale Serve guide](https://tailscale.com/docs/features/tailscale-serve) and [CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

No Cloudflare account, domain, tunnel, or Tailscale setup is modified by this repository’s installer. Those services are configured in their own dashboard or CLI.
