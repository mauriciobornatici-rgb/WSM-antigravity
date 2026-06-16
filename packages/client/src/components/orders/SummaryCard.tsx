import { Card, CardContent } from "@/components/ui/card"

interface SummaryCardProps {
    title: string
    count: number
}

export function SummaryCard({ title, count }: SummaryCardProps) {
    return (
        <Card>
            <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">{title}</p>
                <p className="text-2xl font-bold">{count}</p>
            </CardContent>
        </Card>
    )
}
