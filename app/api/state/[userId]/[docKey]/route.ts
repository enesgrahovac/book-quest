import { NextRequest, NextResponse } from "next/server";

import { STATE_DOC_KEYS, type StateDocKey } from "@/lib/state/stateTypes";
import { readUserStateDoc, writeUserStateDoc } from "@/lib/state/userState";

type RouteParams = {
  params: {
    userId: string;
    docKey: string;
  };
};

function parseDocKey(raw: string): StateDocKey | null {
  const normalized = raw.toUpperCase();
  return STATE_DOC_KEYS.includes(normalized as StateDocKey) ? (normalized as StateDocKey) : null;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const docKey = parseDocKey(params.docKey);
  if (!docKey) {
    return NextResponse.json({ error: "Invalid doc key." }, { status: 400 });
  }

  const doc = await readUserStateDoc(params.userId, docKey);
  return NextResponse.json(doc);
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const docKey = parseDocKey(params.docKey);
  if (!docKey) {
    return NextResponse.json({ error: "Invalid doc key." }, { status: 400 });
  }

  const body = await request.json();
  if (!body?.content || typeof body.content !== "string") {
    return NextResponse.json({ error: "Body must include markdown content." }, { status: 400 });
  }

  const doc = await writeUserStateDoc(params.userId, docKey, body.content);
  return NextResponse.json(doc);
}
