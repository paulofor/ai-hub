package com.aihub.hub.service;

import com.aihub.hub.domain.ProcessRecord;
import com.aihub.hub.dto.ProcessRequest;
import com.aihub.hub.dto.ProcessView;
import com.aihub.hub.repository.ProcessRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;

@Service
public class ProcessService {
    private final ProcessRepository repository;
    public ProcessService(ProcessRepository repository) { this.repository = repository; }
    @Transactional(readOnly = true) public List<ProcessView> list() { return repository.findAllByOrderByNumberAsc().stream().map(this::view).toList(); }
    @Transactional public ProcessView create(ProcessRequest request) { return save(new ProcessRecord(), request, null); }
    @Transactional public ProcessView update(Long id, ProcessRequest request) { return save(repository.findById(id).orElseThrow(() -> notFound()), request, id); }
    @Transactional public void delete(Long id) { if (!repository.existsById(id)) throw notFound(); repository.deleteById(id); }
    private ProcessView save(ProcessRecord record, ProcessRequest request, Long id) {
        String number = request.number().trim();
        boolean duplicate = id == null ? repository.existsByNumberIgnoreCase(number) : repository.existsByNumberIgnoreCaseAndIdNot(number, id);
        if (duplicate) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Já existe um processo com este número");
        record.setNumber(number); record.setText(request.text().trim()); return view(repository.save(record));
    }
    private ResponseStatusException notFound() { return new ResponseStatusException(HttpStatus.NOT_FOUND, "Processo não encontrado"); }
    private ProcessView view(ProcessRecord value) { return new ProcessView(value.getId(), value.getNumber(), value.getText(), value.getCreatedAt(), value.getUpdatedAt()); }
}
