import { escapeHtml, htmlWrapper, profileImageHtml } from "./index";

export function renderInstagramStory(content: unknown, mediaUrls?: string[]): string {
  const c = content as {
    profile?: { username?: string; image?: string; imageBackgroundColor?: string | null };
    content?: { prompt?: string; altText?: string };
    cta?: { text?: string };
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
  const ctaText = escapeHtml(c.cta?.text || "Learn more");
  const imageUrl = mediaUrls?.[0] || "";
  const altText = escapeHtml(c.content?.altText || "Story image");

  const body = `
<div style="max-width:360px;width:100%;border-radius:12px;overflow:hidden;position:relative;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <!-- Progress bar -->
  <div style="position:absolute;top:8px;left:12px;right:12px;z-index:2;">
    <div style="height:2px;background:rgba(255,255,255,0.3);border-radius:2px;">
      <div style="height:2px;width:33%;background:#fff;border-radius:2px;"></div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
      ${profileImg}
      <span style="color:#fff;font-size:13px;font-weight:600;">${username}</span>
      <span style="color:rgba(255,255,255,0.6);font-size:12px;">Sponsored</span>
    </div>
  </div>
  <!-- Image -->
  ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${altText}" style="width:100%;aspect-ratio:9/16;object-fit:cover;background:#222;" />` : `<div style="width:100%;aspect-ratio:9/16;background:#222;"></div>`}
  <!-- CTA -->
  <div style="position:absolute;bottom:16px;left:0;right:0;display:flex;justify-content:center;z-index:2;">
    <div style="background:#fff;color:#262627;padding:8px 24px;border-radius:20px;font-size:14px;font-weight:600;">${ctaText}</div>
  </div>
</div>`;

  return htmlWrapper("Instagram Story", body);
}
