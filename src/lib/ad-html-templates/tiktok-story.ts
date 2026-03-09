import { escapeHtml, htmlWrapper, profileImageHtml } from "./index";

export function renderTiktokStory(content: unknown, mediaUrls?: string[]): string {
  const c = content as {
    profile?: { username?: string; image?: string; imageBackgroundColor?: string | null };
    content?: { prompt?: string; altText?: string };
    caption?: string;
    sound?: { name?: string; author?: string };
    cta?: { text?: string };
  };

  const profile = c.profile;
  const username = escapeHtml(profile?.username || "Your Brand");
  const profileImg = profileImageHtml(
    profile?.image,
    profile?.imageBackgroundColor,
    36,
    username,
    true
  );
  const caption = escapeHtml(c.caption || "");
  const ctaText = escapeHtml(c.cta?.text || "Learn more");
  const soundName = escapeHtml(c.sound?.name || "Original Sound");
  const soundAuthor = escapeHtml(c.sound?.author || username);
  const imageUrl = mediaUrls?.[0] || "";
  const altText = escapeHtml(c.content?.altText || "TikTok ad");

  const body = `
<div style="max-width:360px;width:100%;border-radius:8px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#fff;">
  <div style="position:relative;">
    ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${altText}" style="width:100%;aspect-ratio:9/16;object-fit:cover;background:#161823;" />` : `<div style="width:100%;aspect-ratio:9/16;background:#161823;"></div>`}
    <!-- Footer overlay -->
    <div style="position:absolute;bottom:0;left:0;right:62px;padding:16px;z-index:2;background:linear-gradient(transparent, rgba(0,0,0,0.5));">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">${profileImg}<span style="font-weight:700;font-size:15px;">@${username}</span></div>
      <div style="font-size:13px;margin-bottom:8px;">${caption}</div>
      <div style="font-size:12px;margin-bottom:12px;">&#9835; ${soundName} - ${soundAuthor}</div>
      <div style="background:#fe2c55;color:#fff;padding:8px 16px;border-radius:4px;font-size:14px;font-weight:600;display:inline-block;">${ctaText}</div>
    </div>
  </div>
  <!-- Bottom menu -->
  <div style="display:flex;justify-content:space-around;padding:8px 0;background:#000;font-size:11px;text-align:center;">
    <span>Home</span><span>Discover</span><span style="font-size:24px;">+</span><span>Inbox</span><span>Profile</span>
  </div>
</div>`;

  return htmlWrapper("TikTok Story", body);
}
