import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { buildGardenCalendarItems, type CalendarPlannerItem } from "@/features/calendar/services/calendarPlanner";
import {
  getCalendarTypeMeta,
  getCalendarVisualKind,
  type CalendarVisualKind,
} from "@/features/calendar/services/calendarPresentation";
import { useGardensQuery } from "@/features/gardens/hooks/useGardensQuery";
import { fetchDailyForecast } from "@/features/weather/services/openMeteo";
import { SqliteGardenCropWishlistRepository } from "@/infra/repositories/sqlite/SqliteGardenCropWishlistRepository";
import { SqliteGardenTaskRepository } from "@/infra/repositories/sqlite/SqliteGardenTaskRepository";
import { useSelectedGardenStore } from "@/state/selectedGardenStore";
import { FilterPill } from "@/ui/components/FilterPill";
import { AppButton } from "@/ui/components/AppButton";
import { SegmentedChoice } from "@/ui/components/SegmentedChoice";
import { useTheme } from "@/ui/theme/ThemeProvider";

const wishlistRepository = new SqliteGardenCropWishlistRepository();
const taskRepository = new SqliteGardenTaskRepository();

type CalendarViewMode = "year" | "month" | "week";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FILTER_ORDER: CalendarVisualKind[] = [
  "frost",
  "drought",
  "start_indoors",
  "direct_sow",
  "plant_out",
  "harvest",
  "started_indoors_done",
  "planted_on",
  "seasonal_now",
  "task",
];

export default function CalendarTabScreen() {
  const { theme } = useTheme();
  const now = new Date();
  const [viewMode, setViewMode] = useState<CalendarViewMode>("month");
  const [focusDate, setFocusDate] = useState(startOfDay(now));
  const [selectedDayIso, setSelectedDayIso] = useState(toIsoDay(now));
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Record<CalendarVisualKind, boolean>>(() =>
    Object.fromEntries(FILTER_ORDER.map((kind) => [kind, true])) as Record<CalendarVisualKind, boolean>
  );

  const gardensQuery = useGardensQuery();
  const gardens = gardensQuery.data ?? [];
  const selectedGardenId = useSelectedGardenStore((state) => state.selectedGardenId);
  const setSelectedGardenId = useSelectedGardenStore((state) => state.setSelectedGardenId);
  const selectedGarden = gardens.find((g) => g.id === selectedGardenId) ?? gardens[0] ?? null;
  const activeGardenId = selectedGarden?.id ?? null;

  const wishlistQuery = useQuery({
    queryKey: ["garden-grow-list", activeGardenId],
    enabled: Boolean(activeGardenId),
    queryFn: async () => {
      if (!activeGardenId) return [];
      return wishlistRepository.listByGarden(activeGardenId);
    },
  });

  const plantingsQuery = useQuery({
    queryKey: ["garden-plantings", activeGardenId],
    enabled: Boolean(activeGardenId),
    queryFn: async () => {
      if (!activeGardenId) return [];
      return wishlistRepository.listPlantingsByGarden(activeGardenId);
    },
  });

  const tasksQuery = useQuery({
    queryKey: ["garden-tasks", activeGardenId],
    enabled: Boolean(activeGardenId),
    queryFn: async () => {
      if (!activeGardenId) return [];
      return taskRepository.listByGarden(activeGardenId);
    },
  });

  const forecastQuery = useQuery({
    queryKey: ["calendar-forecast", selectedGarden?.id, selectedGarden?.latitude, selectedGarden?.longitude],
    enabled: Boolean(selectedGarden && (Math.abs(selectedGarden.latitude) > 0.000001 || Math.abs(selectedGarden.longitude) > 0.000001)),
    queryFn: async () => {
      if (!selectedGarden) return [];
      return fetchDailyForecast(selectedGarden.latitude, selectedGarden.longitude, 14);
    },
  });

  const calendarItems = useMemo(() => {
    if (!activeGardenId) return [];
    return buildGardenCalendarItems({
      gardenId: activeGardenId,
      now,
      year: focusDate.getFullYear(),
      wishlist: wishlistQuery.data ?? [],
      activePlantings: plantingsQuery.data ?? [],
      forecast: forecastQuery.data ?? [],
      existingTasks: tasksQuery.data ?? [],
    });
  }, [activeGardenId, focusDate, forecastQuery.data, now, plantingsQuery.data, tasksQuery.data, wishlistQuery.data]);

  const { periodStart, periodEnd } = useMemo(() => {
    if (viewMode === "year") {
      return {
        periodStart: new Date(focusDate.getFullYear(), 0, 1),
        periodEnd: new Date(focusDate.getFullYear(), 11, 31),
      };
    }
    if (viewMode === "week") {
      const start = startOfWeekMonday(focusDate);
      return { periodStart: start, periodEnd: endOfWeekSunday(start) };
    }
    return {
      periodStart: new Date(focusDate.getFullYear(), focusDate.getMonth(), 1),
      periodEnd: new Date(focusDate.getFullYear(), focusDate.getMonth() + 1, 0),
    };
  }, [focusDate, viewMode]);

  const filteredItems = useMemo(() => {
    return calendarItems.filter((item) => {
      const kind = getCalendarVisualKind(item);
      return filters[kind] && overlapsRange(item, periodStart, periodEnd);
    });
  }, [calendarItems, filters, periodEnd, periodStart]);

  const filterCounts = useMemo(() => {
    const counts = new Map<CalendarVisualKind, number>();
    for (const kind of FILTER_ORDER) counts.set(kind, 0);
    for (const item of calendarItems) {
      if (!overlapsRange(item, periodStart, periodEnd)) continue;
      const kind = getCalendarVisualKind(item);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    return counts;
  }, [calendarItems, periodEnd, periodStart]);

  const monthGridStart = useMemo(() => startOfWeekMonday(new Date(focusDate.getFullYear(), focusDate.getMonth(), 1)), [focusDate]);
  const monthGridEnd = useMemo(() => endOfWeekSunday(new Date(focusDate.getFullYear(), focusDate.getMonth() + 1, 0)), [focusDate]);

  const weeks = useMemo(() => {
    if (viewMode === "week") {
      const start = startOfWeekMonday(focusDate);
      return [[0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(start, offset))];
    }
    if (viewMode === "month") {
      const list: Date[][] = [];
      const cursor = new Date(monthGridStart);
      while (cursor <= monthGridEnd) {
        const week: Date[] = [];
        for (let i = 0; i < 7; i += 1) {
          week.push(new Date(cursor));
          cursor.setDate(cursor.getDate() + 1);
        }
        list.push(week);
      }
      return list;
    }
    return [];
  }, [focusDate, monthGridEnd, monthGridStart, viewMode]);

  const dayItemsMap = useMemo(() => {
    const map = new Map<string, CalendarPlannerItem[]>();
    for (const item of filteredItems) {
      const start = startOfDay(new Date(item.startDateIso ?? item.dateIso));
      const end = startOfDay(new Date(item.endDateIso ?? item.dateIso));
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
      const cursor = new Date(start);
      while (cursor <= end) {
        const key = toIsoDay(cursor);
        const rows = map.get(key) ?? [];
        rows.push(item);
        map.set(key, rows);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    for (const [key, rows] of map.entries()) {
      rows.sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      });
      map.set(key, rows);
    }
    return map;
  }, [filteredItems]);

  const selectedDayItems = dayItemsMap.get(selectedDayIso) ?? [];

  const yearMonthSummaries = useMemo(() => {
    const list: Array<{ monthIndex: number; count: number; dotColors: string[] }> = [];
    for (let m = 0; m < 12; m += 1) {
      const start = new Date(focusDate.getFullYear(), m, 1);
      const end = new Date(focusDate.getFullYear(), m + 1, 0);
      const items = filteredItems.filter((item) => overlapsRange(item, start, end));
      const dotColors = items.slice(0, 4).map((item) => getCalendarTypeMeta(item).background);
      list.push({ monthIndex: m, count: items.length, dotColors });
    }
    return list;
  }, [filteredItems, focusDate]);

  const headerLabel =
    viewMode === "year"
      ? `${focusDate.getFullYear()}`
      : viewMode === "week"
        ? `${formatShortDate(toIsoDay(periodStart))} to ${formatShortDate(toIsoDay(periodEnd))}`
        : focusDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <ScrollView style={[styles.page, { backgroundColor: theme.appBackground }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: theme.textPrimary }]}>Calendar</Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>Month grid with simple filters and daily details.</Text>

      <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}> 
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Garden</Text>
        <SegmentedChoice
          options={gardens.map((garden) => ({ id: garden.id, label: garden.name }))}
          selectedId={activeGardenId}
          onSelect={setSelectedGardenId}
        />
      </View>

      <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}> 
        <View style={styles.rowBetween}>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>View</Text>
          <View style={styles.row}>
            <FilterPill label="Year" selected={viewMode === "year"} onPress={() => setViewMode("year")} />
            <FilterPill label="Month" selected={viewMode === "month"} onPress={() => setViewMode("month")} />
            <FilterPill label="Week" selected={viewMode === "week"} onPress={() => setViewMode("week")} />
          </View>
        </View>

        <View style={styles.rowBetween}>
          <AppButton
            label="Prev"
            size="sm"
            variant="secondary"
            style={styles.navButton}
            onPress={() =>
              setFocusDate((prev) =>
                viewMode === "year"
                  ? new Date(prev.getFullYear() - 1, prev.getMonth(), prev.getDate())
                  : viewMode === "week"
                    ? addDays(prev, -7)
                    : new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
              )
            }
          />
          <Text style={[styles.monthTitle, { color: theme.textPrimary }]}>{headerLabel}</Text>
          <AppButton
            label="Next"
            size="sm"
            variant="secondary"
            style={styles.navButton}
            onPress={() =>
              setFocusDate((prev) =>
                viewMode === "year"
                  ? new Date(prev.getFullYear() + 1, prev.getMonth(), prev.getDate())
                  : viewMode === "week"
                    ? addDays(prev, 7)
                    : new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
              )
            }
          />
        </View>

        <View style={styles.rowBetween}>
          <AppButton
            label={showFilters ? "Hide filters" : "Show filters"}
            size="sm"
            variant="neutral"
            style={[
              styles.filterButton,
              {
                backgroundColor: theme.filterControlBackground,
                borderColor: theme.filterControlBorder,
              },
            ]}
            textStyle={{ color: theme.filterControlText }}
            onPress={() => setShowFilters((prev) => !prev)}
          />
          <AppButton
            label="Show all"
            size="sm"
            variant="neutral"
            style={[
              styles.filterButton,
              {
                backgroundColor: theme.filterControlBackground,
                borderColor: theme.filterControlBorder,
              },
            ]}
            textStyle={{ color: theme.filterControlText }}
            onPress={() => setFilters(Object.fromEntries(FILTER_ORDER.map((kind) => [kind, true])) as Record<CalendarVisualKind, boolean>)}
          />
        </View>

        {showFilters && (
          <View style={[styles.filterPanel, { borderColor: theme.borderColor }]}> 
            {FILTER_ORDER.map((kind) => {
              const meta = getCalendarTypeMeta(sampleItemForKind(kind));
              const checked = filters[kind];
              return (
                <Pressable
                  key={kind}
                  style={[styles.filterRow, { borderColor: theme.borderColor }]}
                  onPress={() => setFilters((prev) => ({ ...prev, [kind]: !prev[kind] }))}
                >
                  <View style={[styles.checkbox, { borderColor: meta.border, backgroundColor: checked ? meta.background : theme.appBackground }]}>
                    <Text style={[styles.checkboxMark, { color: checked ? meta.text : theme.textMuted }]}>{checked ? "x" : ""}</Text>
                  </View>
                  <Text style={[styles.filterRowLabel, { color: meta.border }]}>{meta.label}</Text>
                  <Text style={[styles.filterRowCount, { color: theme.textMuted }]}>{filterCounts.get(kind) ?? 0}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {viewMode === "year" ? (
          <View style={styles.yearGrid}>
            {yearMonthSummaries.map((month) => {
              const monthDate = new Date(focusDate.getFullYear(), month.monthIndex, 1);
              return (
                <Pressable
                  key={`month-${month.monthIndex}`}
                  style={[styles.yearMonthCard, { borderColor: theme.borderColor, backgroundColor: theme.appBackground }]}
                  onPress={() => {
                    setFocusDate(monthDate);
                    setViewMode("month");
                    setSelectedDayIso(toIsoDay(monthDate));
                  }}
                >
                  <Text style={[styles.yearMonthTitle, { color: theme.textPrimary }]}>
                    {monthDate.toLocaleDateString("en-GB", { month: "short" })}
                  </Text>
                  <Text style={[styles.yearMonthCount, { color: theme.textMuted }]}>{month.count} events</Text>
                  <View style={styles.dotRow}>
                    {month.dotColors.map((color, idx) => (
                      <View key={`${month.monthIndex}-${idx}`} style={[styles.dot, { backgroundColor: color }]} />
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <>
            <View style={styles.weekHeaderRow}>
              {WEEKDAY_LABELS.map((label) => (
                <Text key={label} style={[styles.weekHeaderText, { color: theme.textMuted }]}>
                  {label}
                </Text>
              ))}
            </View>

            {weeks.map((week, weekIndex) => (
              <View key={`week-${weekIndex}`} style={styles.dayRow}>
                {week.map((date) => {
                  const iso = toIsoDay(date);
                  const inMonth = viewMode === "week" || date.getMonth() === focusDate.getMonth();
                  const isSelected = selectedDayIso === iso;
                  const dayItems = dayItemsMap.get(iso) ?? [];
                  return (
                    <Pressable
                      key={iso}
                      style={[
                        styles.dayCell,
                        {
                          borderColor: isSelected ? theme.primaryActionBackground : theme.borderColor,
                          backgroundColor: inMonth ? theme.surfaceBackground : theme.appBackground,
                        },
                      ]}
                      onPress={() => {
                        setSelectedDayIso(iso);
                        setFocusDate(date);
                      }}
                    >
                      <Text style={[styles.dayNumber, { color: inMonth ? theme.textPrimary : theme.textMuted }]}>{date.getDate()}</Text>
                      <View style={styles.dotRow}>
                        {dayItems.slice(0, 3).map((item, idx) => {
                          const meta = getCalendarTypeMeta(item);
                          return <View key={`${item.id}-${idx}`} style={[styles.dot, { backgroundColor: meta.background }]} />;
                        })}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}> 
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Selected Day: {formatDay(selectedDayIso)}</Text>
        {selectedDayItems.length === 0 ? (
          <Text style={[styles.helper, { color: theme.textMuted }]}>No events on this date.</Text>
        ) : (
          selectedDayItems.map((item) => {
            const meta = getCalendarTypeMeta(item);
            return (
              <View key={item.id} style={[styles.dayItemRow, { borderColor: theme.borderColor }]}> 
                <View style={[styles.dayItemBadge, { backgroundColor: meta.background, borderColor: meta.border }]}> 
                  <Text style={[styles.dayItemBadgeText, { color: meta.text }]}>{meta.label}</Text>
                </View>
                <View style={styles.dayItemMain}>
                  <Text style={[styles.dayItemTitle, { color: theme.textPrimary }]}>{item.title}</Text>
                  {item.detail ? <Text style={[styles.dayItemDetail, { color: theme.textMuted }]}>{item.detail}</Text> : null}
                  {(item.startDateIso || item.endDateIso) && (
                    <Text style={[styles.dayItemDetail, { color: theme.textMuted }]}>Range: {formatRange(item)}</Text>
                  )}
                </View>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

function sampleItemForKind(kind: CalendarVisualKind): Pick<CalendarPlannerItem, "type" | "title" | "detail"> {
  if (kind === "frost") return { type: "weather", title: "Weather alert: frost risk", detail: "" };
  if (kind === "drought") return { type: "weather", title: "Weather alert: prolonged hot and dry spell", detail: "" };
  if (kind === "harvest") return { type: "harvest_window", title: "Harvest", detail: "" };
  if (kind === "started_indoors_done") return { type: "started_indoors_done", title: "Started indoors", detail: "" };
  if (kind === "planted_on") return { type: "planted_on", title: "Planted", detail: "" };
  if (kind === "seasonal_now") return { type: "seasonal_now", title: "Seasonal now", detail: "" };
  if (kind === "task") return { type: "task", title: "Task", detail: "" };
  return { type: kind, title: "", detail: "" } as Pick<CalendarPlannerItem, "type" | "title" | "detail">;
}

function overlapsRange(item: CalendarPlannerItem, start: Date, end: Date): boolean {
  const itemStart = startOfDay(new Date(item.startDateIso ?? item.dateIso));
  const itemEnd = startOfDay(new Date(item.endDateIso ?? item.dateIso));
  if (Number.isNaN(itemStart.getTime()) || Number.isNaN(itemEnd.getTime())) return false;
  return itemStart <= end && itemEnd >= start;
}

function startOfWeekMonday(date: Date): Date {
  const d = startOfDay(date);
  const jsDay = d.getDay();
  const mondayOffset = (jsDay + 6) % 7;
  d.setDate(d.getDate() - mondayOffset);
  return d;
}

function endOfWeekSunday(date: Date): Date {
  const start = startOfWeekMonday(date);
  start.setDate(start.getDate() + 6);
  return start;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toIsoDay(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function formatRange(item: CalendarPlannerItem): string {
  const start = new Date(item.startDateIso ?? item.dateIso);
  const end = new Date(item.endDateIso ?? item.dateIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "-";
  const s = start.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const e = end.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return s === e ? s : `${s} to ${e}`;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 14, gap: 10, paddingBottom: 120 },
  title: { fontSize: 28, fontWeight: "800" },
  subtitle: { fontSize: 13 },
  card: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  cardTitle: { fontWeight: "800" },
  row: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  helper: { fontSize: 12 },

  navButton: { borderRadius: 999, minWidth: 68 },
  monthTitle: { fontWeight: "800", fontSize: 15 },

  filterButton: { borderRadius: 10 },
  filterPanel: { borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  filterRow: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, paddingHorizontal: 8, paddingVertical: 8 },
  checkbox: { width: 18, height: 18, borderWidth: 1, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  checkboxMark: { fontSize: 11, fontWeight: "800" },
  filterRowLabel: { flex: 1, fontWeight: "700", fontSize: 12 },
  filterRowCount: { fontSize: 12, fontWeight: "700" },

  weekHeaderRow: { flexDirection: "row" },
  weekHeaderText: { flex: 1, textAlign: "center", fontWeight: "700", fontSize: 11 },
  dayRow: { flexDirection: "row", gap: 4 },
  dayCell: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 4 },
  dayNumber: { fontWeight: "800", fontSize: 12 },
  dotRow: { flexDirection: "row", gap: 4, marginTop: 3, minHeight: 7, flexWrap: "wrap" },
  dot: { width: 6, height: 6, borderRadius: 999 },

  yearGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  yearMonthCard: { width: "31%", borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 8, gap: 4 },
  yearMonthTitle: { fontWeight: "800", fontSize: 13 },
  yearMonthCount: { fontSize: 11 },

  dayItemRow: { borderWidth: 1, borderRadius: 10, padding: 8, gap: 6 },
  dayItemBadge: { borderWidth: 1, borderRadius: 999, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4 },
  dayItemBadgeText: { fontWeight: "700", fontSize: 10 },
  dayItemMain: { gap: 2 },
  dayItemTitle: { fontWeight: "700", fontSize: 13 },
  dayItemDetail: { fontSize: 12 },
});
