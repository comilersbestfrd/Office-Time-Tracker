import { NextResponse } from 'next/server';
import { getRecordByDate, deleteRecord } from '@/lib/db';

export async function GET(
  request: Request,
  context: any
) {
  try {
    const params = await context.params;
    const record = await getRecordByDate(params.date);
    if (!record) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }
    return NextResponse.json(record);
  } catch (error) {
    console.error('Error fetching record:', error);
    return NextResponse.json({ error: 'Failed to fetch record' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: any
) {
  try {
    const params = await context.params;
    const deleted = await deleteRecord(params.date);
    if (!deleted) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting record:', error);
    return NextResponse.json({ error: 'Failed to delete record' }, { status: 500 });
  }
}

