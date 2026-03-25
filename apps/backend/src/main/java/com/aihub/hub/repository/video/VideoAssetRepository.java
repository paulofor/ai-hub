package com.aihub.hub.repository.video;

import com.aihub.hub.domain.video.VideoAsset;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface VideoAssetRepository extends JpaRepository<VideoAsset, Long> {

    List<VideoAsset> findByProjectIdIn(Collection<Long> projectIds);

    List<VideoAsset> findByProjectIdOrderByCreatedAtAsc(Long projectId);
}
