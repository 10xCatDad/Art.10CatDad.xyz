import type { Metadata } from "next";
import Gallery from "./gallery";
import { isOwner } from "@/lib/auth";
import { getChatGPTUser, chatGPTSignOutPath } from "./chatgpt-auth";
export const dynamic = "force-dynamic";
const title = "10xCatDad // ART & STUFF";
const description = "Art and visual experiments by 10xCatDad.";
const image = { url: "https://art.10xcatdad.xyz/social-card-v1.png", width: 1200, height: 630, type: "image/png", alt: "10xCatDad // ART & STUFF" };
export const metadata: Metadata = {
 title, description,
 alternates: { canonical: "https://art.10xcatdad.xyz/" },
 openGraph: { title, description, type: "website", siteName: "10xCatDad", url: "https://art.10xcatdad.xyz/", images: [image] },
 twitter: { card: "summary_large_image", site: "@10xCatDad", creator: "@10xCatDad", title, description, images: [{ url: image.url, alt: image.alt }] },
};
export default async function Home() {
 const user = await getChatGPTUser();
 return <Gallery owner={await isOwner()} manage={false} signOutPath={user ? chatGPTSignOutPath("/") : undefined} />;
}
