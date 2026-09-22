# Cloudflare connection

The app itself should remain a local HTTP service:

```text
http://localhost:43827
```

Configure your infrastructure so requests follow this path:

```text
https://dl.ischrisworking.com
        ↓
Cloudflare Access
        ↓
Cloudflare Tunnel
        ↓
http://localhost:43827
```

The remaining setup is external to this app:

1. Run the production app persistently with `npm run build` followed by `npm start` (or your preferred desktop process manager).
2. Point the Cloudflare Tunnel ingress for `dl.ischrisworking.com` at `http://localhost:43827` or at Caddy if Caddy is your local origin.
3. Protect the hostname with a Cloudflare Access policy before making it reachable.
4. Choose the Access session duration you prefer.
5. If Caddy fronts Next.js locally, proxy to `localhost:43827` and preserve normal forwarding headers.

No login, Access token validation, tunnel configuration, or Cloudflare SDK is included in the application.
