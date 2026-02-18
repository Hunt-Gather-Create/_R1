import { escapeHtml, htmlWrapper, profileImageHtml } from "./index";

export function renderInstagramFeedPost(content: unknown, mediaUrls?: string[]): string {
  const c = content as {
    profile?: { username?: string; image?: string; imageBackgroundColor?: string | null };
    caption?: string;
    content?: { prompt?: string; altText?: string };
    cta?: { text?: string };
    aspectRatio?: string;
    likes?: number;
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
  const likes = c.likes ?? 15;
  const imageUrl = mediaUrls?.[0] || "";
  const altText = escapeHtml(c.content?.altText || "Ad image");

  const body = `
<div style="max-width:500px;width:100%;background:#fff;border:1px solid #dbdbdb;border-radius:4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#262627;font-size:14px;">
  <!-- Header -->
  <div style="display:flex;align-items:center;padding:12px 16px;gap:10px;">
    ${profileImg}
    <div style="flex:1;">
      <div style="font-weight:600;font-size:14px;">${username}</div>
      <div style="font-size:12px;color:#737373;">Sponsored</div>
    </div>
  </div>
  <!-- Image -->
  ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${altText}" style="width:100%;aspect-ratio:1/1;object-fit:cover;background:#f0f0f0;" />` : `<div style="width:100%;aspect-ratio:1/1;background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#999;font-size:14px;">Image placeholder</div>`}
  <!-- CTA Strip -->
  <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#fafafa;border-top:1px solid #efefef;border-bottom:1px solid #efefef;">
    <span style="font-size:14px;font-weight:600;">${ctaText}</span>
  </div>
  <!-- Likes & Caption -->
  <div style="padding:12px 16px;">
    <div style="font-weight:600;font-size:14px;margin-bottom:6px;">${likes.toLocaleString()} likes</div>
    <div><span style="font-weight:600;">${username}</span> ${caption}</div>
  </div>
</div>`;

  return htmlWrapper("Instagram Feed Post", body);
}
