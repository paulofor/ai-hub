package com.aihub.hub.repository.video;

import com.aihub.hub.domain.video.VideoProject;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface VideoProjectRepository extends JpaRepository<VideoProject, Long> {

    Optional<VideoProject> findByCode(String code);
}
