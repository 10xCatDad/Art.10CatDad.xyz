import Gallery from "../gallery";
import { requireChatGPTUser, chatGPTSignOutPath } from "../chatgpt-auth";
import { isOwner } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function Manage() {
 await requireChatGPTUser("/manage");
 if (!await isOwner()) return <main className="access-message"><h1>Owner access only</h1><p>Sign in with the gallery owner’s ChatGPT account to upload or edit images.</p><a href={chatGPTSignOutPath("/manage")} target="_top">Use another account</a><a href="/">Back to gallery</a></main>;
 return <Gallery owner manage />;
}
