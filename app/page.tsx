import Gallery from "./gallery";
import { isOwner } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function Home() { return <Gallery owner={await isOwner()} manage={false} />; }
