import { NextResponse } from 'next/server';
import { getHolidays, saveHoliday } from '@/lib/db';

export async function GET() {
  try {
    const holidays = await getHolidays();
    return NextResponse.json(holidays);
  } catch (error) {
    console.error('Error fetching holidays:', error);
    return NextResponse.json({ error: 'Failed to fetch holidays' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.date || !body.name) {
      return NextResponse.json({ error: 'Date and Name are required fields' }, { status: 400 });
    }
    const updated = await saveHoliday(body);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error saving holiday:', error);
    return NextResponse.json({ error: 'Failed to save holiday' }, { status: 500 });
  }
}
