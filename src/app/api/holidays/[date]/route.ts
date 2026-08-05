import { NextResponse } from 'next/server';
import { deleteHoliday } from '@/lib/db';

export async function DELETE(
  request: Request,
  context: any
) {
  try {
    const params = await context.params;
    const deleted = await deleteHoliday(params.date);
    if (!deleted) {
      return NextResponse.json({ error: 'Holiday not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting holiday:', error);
    return NextResponse.json({ error: 'Failed to delete holiday' }, { status: 500 });
  }
}
