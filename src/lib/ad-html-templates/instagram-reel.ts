import { escapeHtml, htmlWrapper, profileImageHtml } from "./index";

export function renderInstagramReel(content: unknown, mediaUrls?: string[]): string {
  const c = content as {
    profile?: { username?: string; image?: string; imageBackgroundColor?: string | null };
    caption?: string;
    content?: { prompt?: string; altText?: string };
    cta?: { text?: string };
    likes?: number;
    comments?: number;
  };

  const profile = c.profile;
  const username = escapeHtml(profile?.username || "Your Brand");
  const profileImg = profileImageHtml(
    profile?.image,
    profile?.imageBackgroundColor,
    32,
    username,
    true
  );
  const caption = escapeHtml(c.caption || "");
  const ctaText = escapeHtml(c.cta?.text || "Learn more");
  const likes = c.likes ?? 15;
  const comments = c.comments ?? 34;
  const imageUrl = mediaUrls?.[0] || "";
  const altText = escapeHtml(c.content?.altText || "Reel image");

  const body = `
<div style="max-width:360px;width:100%;border-radius:12px;overflow:hidden;position:relative;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${altText}" style="width:100%;aspect-ratio:9/16;object-fit:cover;background:#222;" />` : `<div style="width:100%;aspect-ratio:9/16;background:#222;"></div>`}
  <!-- Overlay -->
  <div style="position:absolute;bottom:0;left:0;right:0;padding:16px;z-index:2;background:linear-gradient(transparent, rgba(0,0,0,0.6));">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;">
      <div style="flex:1;color:#fff;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          ${profileImg}
          <span style="font-weight:600;font-size:13px;">${username}</span>
        </div>
        <div style="font-size:13px;margin-bottom:12px;">${caption}</div>
        <div style="background:#fff;color:#262627;padding:8px 20px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block;">${ctaText}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:16px;color:#fff;font-size:12px;margin-left:16px;">
        <div style="text-align:center;"><div style="font-size:20px;">&#9825;</div>${likes}</div>
        <div style="text-align:center;"><div style="font-size:20px;">&#128172;</div>${comments}</div>
      </div>
    </div>
  </div>
</div>`;

  return htmlWrapper("Instagram Reel", body);
}
