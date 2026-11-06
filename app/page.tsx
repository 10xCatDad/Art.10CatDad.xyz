import Gallery from "./gallery";
import { isOwner } from "@/lib/auth";
import { getChatGPTUser, chatGPTSignOutPath } from "./chatgpt-auth";
export const dynamic = "force-dynamic";
export default async function Home() {
 const user = await getChatGPTUser();
 return <Gallery owner={await isOwner()} manage={false} signOutPath={user ? chatGPTSignOutPath("/") : undefined} />;
}
