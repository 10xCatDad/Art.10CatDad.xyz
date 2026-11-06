import { requireChatGPTUser, chatGPTSignOutPath } from "@/app/chatgpt-auth";
import { isOwner } from "@/lib/auth";
import Devices from "./devices";
export const dynamic = "force-dynamic";
export const metadata = { title: "Devices // 10xCatDad", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function DevicePage() {
 await requireChatGPTUser("/manage/devices");
 if (!await isOwner()) return <main className="access-message"><h1>Owner access only</h1><a href={chatGPTSignOutPath("/manage/devices")} target="_top">Use another account</a></main>;
 return <Devices />;
}
