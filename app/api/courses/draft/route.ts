import { NextRequest, NextResponse } from "next/server";
import {
  readCourseDraft,
  saveCourseDraft,
  deleteCourseDraft,
} from "@/lib/state/courseFiles";

const USER_ID = "local-learner";

export async function GET() {
  const draft = await readCourseDraft(USER_ID);
  if (!draft) {
    return NextResponse.json({ draft: null });
  }
  return NextResponse.json({ draft });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  await saveCourseDraft(USER_ID, {
    messages: body.messages ?? [],
    bookAnalysis: body.bookAnalysis ?? null,
    courseId: body.courseId ?? null,
    coursePlan: body.coursePlan ?? null,
    editablePlan: body.editablePlan ?? null,
    knownGaps: body.knownGaps ?? [],
    readyToGenerate: body.readyToGenerate ?? false,
    requestingUpload: body.requestingUpload ?? false,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await deleteCourseDraft(USER_ID);
  return NextResponse.json({ ok: true });
}
