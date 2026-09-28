package evalprecompute

import "sort"

func OrphanKeys(existing map[string]bool, live []string) []string {
	liveSet := make(map[string]bool, len(live))
	for _, key := range live {
		liveSet[key] = true
	}
	var orphans []string
	for key := range existing {
		if !liveSet[key] {
			orphans = append(orphans, key)
		}
	}
	sort.Strings(orphans)
	return orphans
}
