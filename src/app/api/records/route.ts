import { NextResponse } from 'next/server';
import { getRecords, saveRecord, clearRecords } from '@/lib/db';

export async function GET() {
  try {
    const records = await getRecords();
    return NextResponse.json(records);
  } catch (error) {
    console.error('Error fetching records:', error);
    return NextResponse.json({ error: 'Failed to fetch records' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.date || !body.status) {
      return NextResponse.json({ error: 'Date and Status are required fields' }, { status: 400 });
    }
    const updated = await saveRecord(body);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error saving record:', error);
    return NextResponse.json({ error: 'Failed to save record' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await clearRecords();
    return NextResponse.json({ success: true, message: 'All records cleared' });
  } catch (error) {
    console.error('Error resetting database:', error);
    return NextResponse.json({ error: 'Failed to clear records' }, { status: 500 });
  }
}
