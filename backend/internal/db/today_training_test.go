package db

import "testing"

func TestRankForInsertUsesGapBetweenNeighbors(t *testing.T) {
	entries := []rankedTodayTrainingEntry{
		{rank: queueRankGap},
		{rank: queueRankGap * 2},
	}
	rank, rebalance := rankForInsert(entries, 1)
	if rebalance || rank != queueRankGap+queueRankGap/2 {
		t.Fatalf("rankForInsert() = %d, %v", rank, rebalance)
	}
}

func TestRankForInsertRequestsRebalanceWithoutGap(t *testing.T) {
	entries := []rankedTodayTrainingEntry{{rank: 5}, {rank: 6}}
	if _, rebalance := rankForInsert(entries, 1); !rebalance {
		t.Fatal("expected rebalance")
	}
}
