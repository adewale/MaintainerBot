type Env = {
	MAINTAINERBOT_R2: R2Bucket;
};

export default {
	async fetch(request: Request, env: Env) {
		const url = new URL(request.url);
		if (url.pathname === '/health') return new Response('ok');
		if (url.pathname === '/raw' || url.pathname === '/MaintainerBotOut.md') {
			const object = await env.MAINTAINERBOT_R2.get('MaintainerBotOut.md');
			if (!object) return new Response('MaintainerBotOut.md not found', { status: 404 });
			return new Response(await object.text(), {
				headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=60' },
			});
		}
		if (url.pathname === '/json' || url.pathname === '/MaintainerBotOut.json') {
			const object = await env.MAINTAINERBOT_R2.get('MaintainerBotOut.json');
			if (!object) return new Response('MaintainerBotOut.json not found', { status: 404 });
			return new Response(await object.text(), {
				headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' },
			});
		}

		const object = await env.MAINTAINERBOT_R2.get('MaintainerBotOut.md');
		if (!object) return new Response('MaintainerBotOut.md not found', { status: 404 });
		const markdown = await object.text();
		return new Response(renderPage(markdown), {
			headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' },
		});
	},
};

function renderPage(markdown: string) {
	const title = markdown.match(/^#\s+(.+)$/m)?.[1] ?? 'MaintainerBot Status';
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; --bg:#0b1020; --panel:#111936; --text:#e8eefc; --muted:#aab6d3; --link:#8ec5ff; --border:#26345f; --code:#1b2548; }
@media (prefers-color-scheme: light) { :root { --bg:#f6f8fc; --panel:#fff; --text:#111827; --muted:#5b6475; --link:#0757c2; --border:#d8deea; --code:#eef2f8; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:16px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 32px 18px 64px; }
article { background: var(--panel); border:1px solid var(--border); border-radius:18px; padding: 28px; box-shadow: 0 20px 60px rgba(0,0,0,.18); }
h1 { font-size: clamp(2rem, 5vw, 3.6rem); line-height:1; margin:0 0 18px; letter-spacing:-.04em; }
h2 { font-size:1.55rem; margin: 34px 0 12px; padding-top:22px; border-top:1px solid var(--border); }
h3 { font-size:1.05rem; margin: 24px 0 8px; color: var(--text); }
p, ul { margin: 0 0 14px; }
ul { padding-left: 1.4rem; }
li { margin: 6px 0; }
a { color: var(--link); text-decoration-thickness: .08em; text-underline-offset: .16em; }
code { background: var(--code); padding:.12rem .34rem; border-radius:.35rem; }
pre { overflow:auto; background:var(--code); padding:14px; border-radius:12px; }
.masthead { display:flex; gap:12px; align-items:center; justify-content:space-between; color:var(--muted); margin-bottom:18px; flex-wrap:wrap; }
.badge { border:1px solid var(--border); border-radius:999px; padding:5px 10px; font-size:.9rem; }
.actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:24px; }
.actions a { border:1px solid var(--border); border-radius:10px; padding:8px 12px; text-decoration:none; }
</style>
</head>
<body>
<main>
<div class="masthead"><span class="badge">MaintainerBot live R2 status</span><span>Auto-updated after every run</span></div>
<article>${markdownToHtml(markdown)}</article>
<div class="actions"><a href="/raw">Raw Markdown</a><a href="/json">JSON</a><a href="https://github.com/adewale/MaintainerBot">GitHub</a></div>
</main>
</body>
</html>`;
}

function markdownToHtml(markdown: string) {
	const lines = markdown.split(/\r?\n/);
	let html = '';
	let inList = false;
	for (const line of lines) {
		if (line.trim() === '') {
			if (inList) { html += '</ul>'; inList = false; }
			continue;
		}
		const heading = line.match(/^(#{1,3})\s+(.+)$/);
		if (heading) {
			if (inList) { html += '</ul>'; inList = false; }
			const level = heading[1].length;
			html += `<h${level}>${inline(heading[2])}</h${level}>`;
			continue;
		}
		const bullet = line.match(/^-\s+(.+)$/);
		if (bullet) {
			if (!inList) { html += '<ul>'; inList = true; }
			html += `<li>${inline(bullet[1])}</li>`;
			continue;
		}
		if (inList) { html += '</ul>'; inList = false; }
		html += `<p>${inline(line)}</p>`;
	}
	if (inList) html += '</ul>';
	return html;
}

function inline(value: string) {
	return escapeHtml(value)
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
}

function escapeHtml(value: string) {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
