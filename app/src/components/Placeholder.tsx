import { Screen, ScreenTitle, Card, MutedText } from '@/src/components/ui';

export function PlaceholderScreen({ title, note }: { title: string; note: string }) {
  return (
    <Screen>
      <ScreenTitle>{title}</ScreenTitle>
      <Card>
        <MutedText>{note}</MutedText>
      </Card>
    </Screen>
  );
}
