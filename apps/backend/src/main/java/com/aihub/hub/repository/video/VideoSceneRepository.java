package com.aihub.hub.repository.video;

import com.aihub.hub.domain.video.VideoScene;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface VideoSceneRepository extends JpaRepository<VideoScene, Long> {

    List<VideoScene> findByProjectIdIn(Collection<Long> projectIds);

    List<VideoScene> findByProjectIdOrderBySequenceIndexAsc(Long projectId);
}
