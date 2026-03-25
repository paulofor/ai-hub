package com.aihub.hub.repository.video;

import com.aihub.hub.domain.video.VideoRenderJob;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface VideoRenderJobRepository extends JpaRepository<VideoRenderJob, Long> {

    List<VideoRenderJob> findByProjectIdIn(Collection<Long> projectIds);

    Optional<VideoRenderJob> findTopByProjectIdOrderByRequestedAtDesc(Long projectId);
}
